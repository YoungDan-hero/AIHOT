// Collection picks up where it stopped: an X search longer than one run continues in later runs until
// it meets the old watermark (no post in between is skipped, no page is bought twice). The watermark
// alone bounds it: posts made weeks before the account was added are kept too.
import { gate, Reply, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from "undici";
import { DEPLOYMENT } from "@aihot/site";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { collectSource } from "@aihot/backend/sources/collect";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";

const T = tag();
const X_SOURCE = `test-x-${T}`;

// SocialData: 45 posts newer than the watermark, newest first half a day apart, 2 a page; `cursor` is the page number.
const BASE = BigInt(Date.now()) * 1000n;
const WATERMARK = BASE + 100n;
const POSTS = Array.from({ length: 45 }, (_, i) => BASE + 145n - BigInt(i));
const tweet = (id: bigint) => ({
  id_str: String(id), tweet_created_at: new Date(Date.now() - Number(BASE + 145n - id) * 12 * 3_600_000).toISOString(),
  full_text: `Post ${id} ${T}`, lang: "en", user: { name: "Test account", screen_name: `acct${T}` },
});
let heldResponse: (() => Promise<unknown>) | null = null;
const socialdata = await stub(async (_hit, req) => {
  if (heldResponse) return heldResponse();
  const u = new URL(req.url, "http://stub");
  const since = BigInt(/since_id:(\d+)/.exec(u.searchParams.get("query") ?? "")?.[1] ?? "0");
  const page = Number(u.searchParams.get("cursor") ?? 0);
  const ids = POSTS.filter((id) => id > since);
  return { tweets: ids.slice(page * 2, page * 2 + 2).map(tweet), next_cursor: (page + 1) * 2 < ids.length ? String(page + 1) : null };
});

process.env.SOCIALDATA_BASE_URL = socialdata.url;
process.env.SOCIALDATA_API_KEY = "test-key";
config.allowPrivateNetworkFetch = true;

before(async () => {
  await sql`UPDATE budgets SET per_minute = 1000, per_hour = 10000, per_day = 100000 WHERE service = 'socialdata'`;
  await sql`INSERT INTO sources (id, name, kind, config, tier, participation_mode, cursor, next_fetch_at)
            VALUES (${X_SOURCE}, 'Test X', 'x_search', ${sql.json({ query: `from:acct${T}` })}, 'T1', 'editorial',
                    ${sql.json({ initializedAt: new Date().toISOString(), lastTweetId: String(WATERMARK) })}, '2100-01-01')`;
});
after(async () => {
  await socialdata.close();
  await stopBoss();
  await closeDb();
});

test("an X search longer than one run is read to the old watermark over the next runs", async () => {
  const stored = async () => Number((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id = ${X_SOURCE}`)[0]!.n);
  const cursor = async () => (await sql<{ cursor: { lastTweetId: string; xBacklog?: unknown[] } }[]>`SELECT cursor FROM sources WHERE id = ${X_SOURCE}`)[0]!.cursor;

  const first = await collectSource(X_SOURCE, { force: true });
  assert.equal(first.status, "ok");
  assert.equal(await stored(), 40, "a run reads its own pages and ten more of the stretch left over");
  assert.equal((await cursor()).lastTweetId, String(BASE + 145n), "the watermark moves to the newest post");
  assert.equal((await cursor()).xBacklog?.length, 1, "the unread stretch is kept for the next run");
  const [run] = await sql<{ detail: { truncated: boolean; backlog: number } }[]>`SELECT detail FROM fetch_runs WHERE source_id = ${X_SOURCE} ORDER BY id DESC LIMIT 1`;
  assert.deepEqual([run!.detail.truncated, run!.detail.backlog], [true, 1], "the admin sees the stretch still to read");

  const receipts = await sql`SELECT status FROM receipts WHERE service = 'socialdata' AND subject = ${`source:${X_SOURCE}`}`;
  assert.equal(receipts.length, 20);
  assert.ok(receipts.every((r) => r.status === "completed"), "stored pages complete with the saved coverage, including backlog pages");

  const second = await collectSource(X_SOURCE, { force: true });
  assert.equal(second.status, "ok");
  assert.equal(await stored(), 45, "every post between the old watermark and the newest is stored");
  assert.equal((await cursor()).xBacklog, undefined, "nothing is left to read");
  assert.equal(socialdata.hits(), 20 + 1 + 3, "no page is requested twice");
});

test("a stretch left over for days is given up instead of bought again", async () => {
  const stale = new Date(Date.now() - 5 * 86_400_000).toISOString();
  const query = `from:acct${T} since_id:${BASE + 1n}`;
  await sql`UPDATE sources SET cursor = cursor || ${sql.json({ xBacklog: [{ query, next: "0", at: stale }] })}
            WHERE id = ${X_SOURCE}`;
  const res = await collectSource(X_SOURCE, { force: true });
  assert.equal(res.status, "ok");
  const [kept] = await sql<{ cursor: { xBacklog?: unknown[] } }[]>`SELECT cursor FROM sources WHERE id = ${X_SOURCE}`;
  assert.equal(kept!.cursor.xBacklog, undefined, "the old stretch is not kept");
  const paid = await sql`SELECT id FROM receipts WHERE request->>'query' = ${query}`;
  assert.equal(paid.length, 0, "the old stretch's page is not requested again");
  const [run] = await sql<{ detail: { dropped: number } }[]>`SELECT detail FROM fetch_runs WHERE source_id = ${X_SOURCE} ORDER BY id DESC LIMIT 1`;
  assert.equal(run!.detail.dropped, 1, "the admin sees the stretch given up");
});

test("finishing an in-flight collection cannot overwrite a source's paused state", async () => {
  for(const failed of [false,true]) {
    const id=`paused-${failed}-${T}`,entered=gate(),release=gate();
    await sql`INSERT INTO sources(id,name,kind,config) VALUES(${id},${id},'x_search',${sql.json({query:`from:paused${failed}${T}`})})`;
    heldResponse=async()=>{entered.open();await release.promise;return failed?new Reply(400,{error:"refused source"}):{tweets:[]};};
    try {
      const collecting=collectSource(id,{force:true});
      await entered.promise;
      await sql`UPDATE sources SET enabled=false,health='paused' WHERE id=${id}`;
      release.open();
      assert.equal((await collecting).status,failed?'failed':'ok');
      assert.equal((await sql`SELECT health FROM sources WHERE id=${id}`)[0]!.health,'paused');
    } finally {release.open();heldResponse=null;}
  }
});

test("host pacing spaces concurrent requests, cancels an expired wait and recovers", async () => {
  const starts: number[] = [];
  const server = await stub(() => { starts.push(Date.now()); return { ok: true }; });
  const intervals = (DEPLOYMENT as { publicFetchIntervalsMs: Partial<Record<string, number>> }).publicFetchIntervalsMs;
  intervals["127.0.0.1"] = 120;
  try {
    await sql`DELETE FROM settings WHERE key = 'egress.host.127.0.0.1'`;
    await Promise.all([1, 2, 3].map(i => guardedFetch(`${server.url}/${i}`)));
    assert.equal(starts.length, 3);
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i]! - starts[i - 1]! >= 105, "requests must not start together");
    await assert.rejects(guardedFetch(`${server.url}/expired`, { timeoutMs: 20 }), { name: "TimeoutError" });
    await delay(140);
    assert.equal(starts.length, 3, "an expired permit wait must never dispatch later");
    assert.equal((await guardedFetch(`${server.url}/recovered`)).status, 200);
  } finally {
    delete intervals["127.0.0.1"];
    await sql`DELETE FROM settings WHERE key = 'egress.host.127.0.0.1'`;
    await server.close();
  }
});

test("redirects between bare and www hosts share one pacing permit", async () => {
  const intervals = (DEPLOYMENT as { publicFetchIntervalsMs: Partial<Record<string, number>> }).publicFetchIntervalsMs;
  intervals["paced.invalid"] = 120;
  const previous = getGlobalDispatcher(), mock = new MockAgent();
  mock.disableNetConnect();
  const starts: number[] = [];
  mock.get("https://paced.invalid").intercept({ path: "/start" }).reply(() => {
    starts.push(Date.now()); return { statusCode: 302, data: "", responseOptions: { headers: { location: "https://www.paced.invalid/final" } } };
  });
  mock.get("https://www.paced.invalid").intercept({ path: "/final" }).reply(() => { starts.push(Date.now()); return { statusCode: 200, data: "paced" }; });
  setGlobalDispatcher(mock);
  try {
    await sql`DELETE FROM settings WHERE key = 'egress.host.paced.invalid'`;
    assert.equal((await guardedFetch("https://paced.invalid/start")).text(), "paced");
    assert.equal(starts.length, 2);
    assert.ok(starts[1]! - starts[0]! >= 105);
    assert.equal((await sql`SELECT key FROM settings WHERE key IN ('egress.host.paced.invalid', 'egress.host.www.paced.invalid')`).length, 1);
  } finally {
    delete intervals["paced.invalid"];
    setGlobalDispatcher(previous); await mock.close();
    await sql`DELETE FROM settings WHERE key = 'egress.host.paced.invalid'`;
  }
});

test("separate API and worker processes share the same host pacing state", async () => {
  const starts: number[] = [];
  const server = await stub(() => { starts.push(Date.now()); return { ok: true }; });
  const intervals = (DEPLOYMENT as { publicFetchIntervalsMs: Partial<Record<string, number>> }).publicFetchIntervalsMs;
  intervals["127.0.0.1"] = 160;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", `
    import { config } from ${JSON.stringify(new URL("../packages/backend/src/config.ts", import.meta.url).href)};
    import { DEPLOYMENT } from ${JSON.stringify(new URL("../site/site.ts", import.meta.url).href)};
    import { guardedFetch } from ${JSON.stringify(new URL("../packages/backend/src/lib/http-fetch.ts", import.meta.url).href)};
    import { closeDb } from ${JSON.stringify(new URL("../packages/backend/src/db.ts", import.meta.url).href)};
    config.allowPrivateNetworkFetch = true;
    DEPLOYMENT.publicFetchIntervalsMs['127.0.0.1'] = 160;
    process.send('ready');
    process.once('message', async () => {
      try { await guardedFetch(${JSON.stringify(server.url + "/worker")}); process.send('done'); }
      catch (error) { process.send({ error: String(error) }); }
      finally { await closeDb(); process.disconnect(); }
    });
  `], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
  try {
    const ready = await Promise.race([once(child, "message"), once(child, "exit").then(() => { throw new Error("pacing fixture stopped before ready"); })]);
    assert.equal(ready[0], "ready");
    await sql`DELETE FROM settings WHERE key = 'egress.host.127.0.0.1'`;
    const done = once(child, "message");
    child.send("go");
    const [, [result]] = await Promise.all([guardedFetch(server.url + "/preview"), done]);
    assert.equal(result, "done");
    assert.equal(starts.length, 2);
    assert.ok(starts[1]! - starts[0]! >= 145, "separate processes must not maintain separate pacing clocks");
  } finally {
    delete intervals["127.0.0.1"];
    child.kill();
    await sql`DELETE FROM settings WHERE key = 'egress.host.127.0.0.1'`;
    await server.close();
  }
});
