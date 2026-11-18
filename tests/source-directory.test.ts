import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { registerNotifyJobs } from "@aihot/backend/jobs/notify";
import { getBoss, QUEUES, stopBoss } from "@aihot/backend/jobs/queue";
import type { SourceDirectoryResponse } from "@aihot/contracts/site";
import { buildApp } from "../apps/api/src/app.ts";

const app = await buildApp();
after(async () => { await stopBoss(); await app.close(); await closeDb(); });

test("the reader's source list pages through all matching names and publishes only the live status and last attempt", async () => {
  const lastAttempt = "2026-11-18T05:35:00.000Z";
  await sql`
    INSERT INTO sources (id, name, kind, enabled, health, last_fetch_at, config, last_error, tags)
    VALUES ('directory-paused', 'Inbox%（仅编辑可见）', 'rss', false, 'degraded', ${new Date(lastAttempt)}, '{"note":"private"}', 'internal failure', ARRAY['海外信源']),
           ('directory-new', 'Inbox New', 'rss', true, 'unknown', NULL, '{}', NULL, ARRAY['国内信源'])`;
  await sql`
    INSERT INTO sources (id, name, kind, health, tags)
    SELECT 'directory-' || n, 'Inbox ' || lpad(n::text, 2, '0'), 'rss', 'ok',
           ARRAY[CASE WHEN n < 50 THEN '国内信源' ELSE '海外信源' END]
    FROM generate_series(1, 50) AS n`;
  async function read(query: string) {
    const response = await app.inject("/api/site/sources?" + query);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    return response.json<SourceDirectoryResponse>();
  }

  const first = await read("q=inbox");
  const second = await read("q=inbox&page=2");
  assert.deepEqual([first.page, first.pageCount, first.total, first.items.length], [1, 2, 52, 50]);
  assert.deepEqual([second.page, second.pageCount, second.total, second.items.length], [2, 2, 52, 2]);
  assert.deepEqual(second.items.map((row) => row.id).sort(), ["directory-50", "directory-paused"]);
  assert.equal(new Set([...first.items, ...second.items].map((row) => row.id)).size, 52);
  assert.deepEqual((await read("q=inbox&page=999999")).items, second.items);
  assert.deepEqual(await read("q=inbox%25&status=paused"), {
    items: [{ id: "directory-paused", name: "Inbox%", status: "paused", lastFetchAt: lastAttempt }],
    total: 1, page: 1, pageCount: 1,
  });
  assert.equal((await read("q=inbox&status=unknown")).items[0]?.lastFetchAt, null);
  assert.deepEqual(await read("q=" + encodeURIComponent("仅编辑可见")), { items: [], total: 0, page: 1, pageCount: 1 });
  assert.equal((await app.inject("/api/site/sources?status=__proto__")).statusCode, 400);
});

test("source suggestions validate their fields and store repeated submissions once without adding a source", async () => {
  const post = (payload: object) => app.inject({ method: "POST", url: "/api/site/source-suggestions", payload });
  for (const payload of [
    { name: " ", url: "https://example.org/feed" },
    { name: "Suggested source", url: "javascript:alert(1)" },
    { name: "Suggested source", url: "https://user:password@example.org/feed" },
  ]) {
    assert.equal((await post(payload)).statusCode, 400);
  }
  const suggestion = { name: " Suggested source ", url: "https://example.org/feed?q=drama" };
  const responses = await Promise.all([post(suggestion), post(suggestion)]);
  assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 201]);
  for (const response of responses) {
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(response.json(), { ok: true });
  }
  const saved = await sql`SELECT name, url FROM source_suggestions WHERE name = 'Suggested source'`;
  assert.deepEqual(Array.from(saved), [{ name: "Suggested source", url: suggestion.url }]);
  const directory = await app.inject("/api/site/sources?q=Suggested%20source");
  assert.equal(directory.json<SourceDirectoryResponse>().total, 0);
});

test("each new source suggestion queues one private Feishu card with the same UUID on retry", async (t) => {
  const fixtureEnv = {
    FEISHU_EMPLOYEE_LOGIN_ENABLED: "true",
    FEISHU_EMPLOYEE_APP_ID: "cli_fixture",
    FEISHU_EMPLOYEE_APP_SECRET: "fixture-secret",
    FEISHU_SOURCE_SUGGESTION_NOTIFY_ENABLED: "true",
    FEISHU_SOURCE_SUGGESTION_RECIPIENT_UNION_ID: "on_fixture",
  };
  const previous = Object.fromEntries(Object.keys(fixtureEnv).map((name) => [name, process.env[name]]));
  Object.assign(process.env, fixtureEnv);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const sent: Array<{ receive_id: string; msg_type: string; content: string; uuid: string }> = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const endpoint = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(endpoint.origin, "https://open.feishu.cn");
    assert.equal(init?.method, "POST");
    if (endpoint.pathname === "/open-apis/auth/v3/tenant_access_token/internal") {
      assert.deepEqual(JSON.parse(String(init?.body)), { app_id: "cli_fixture", app_secret: "fixture-secret" });
      return Response.json({ code: 0, tenant_access_token: "tenant-fixture", expire: 7200 });
    }
    assert.equal(endpoint.pathname, "/open-apis/im/v1/messages");
    assert.equal(endpoint.searchParams.get("receive_id_type"), "union_id");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer tenant-fixture");
    sent.push(JSON.parse(String(init?.body)));
    return sent.length === 1 ? Response.json({ code: 999 }, { status: 503 }) : Response.json({ code: 0, data: { message_id: "om_fixture" } });
  });

  const suggestion = { name: "通知推送测试信源", url: "https://example.org/notified-source" };
  const post = () => app.inject({
    method: "POST", url: "/api/site/source-suggestions", payload: suggestion,
    headers: { origin: new URL(config.siteUrl).origin },
  });
  assert.equal((await post()).statusCode, 201);
  assert.equal((await post()).statusCode, 200);
  assert.equal(sent.length, 0);

  const [saved] = await sql<{ id: string }[]>`SELECT id FROM source_suggestions WHERE name = ${suggestion.name} AND url = ${suggestion.url}`;
  const jobs = await sql<{ data: unknown; id: string }[]>`SELECT id, data FROM pgboss.job WHERE name = ${QUEUES.notifySourceSuggestion}`;
  assert.ok(saved);
  assert.deepEqual(jobs.map(({ data }) => data), [{ suggestionId: saved.id }]);
  const id = jobs[0]!.id;
  await registerNotifyJobs(await getBoss());

  async function waitForState(expected: "retry" | "completed") {
    const end = Date.now() + 10_000;
    for (;;) {
      const [job] = await sql<{ state: string }[]>`SELECT state FROM pgboss.job WHERE id = ${id}`;
      if (job?.state === expected) return;
      if (Date.now() >= end) assert.equal(job?.state, expected);
      await setTimeout(40);
    }
  }
  await waitForState("retry");
  await sql`UPDATE pgboss.job SET start_after = now() - interval '1 second' WHERE id = ${id}`;
  await waitForState("completed");

  assert.equal(sent.length, 2);
  assert.ok(sent[0]?.uuid);
  assert.equal(sent[1]?.uuid, sent[0].uuid);
  for (const card of sent) {
    assert.equal(card.receive_id, "on_fixture");
    assert.equal(card.msg_type, "interactive");
    const content = JSON.stringify(JSON.parse(card.content));
    assert.ok(content.includes(suggestion.name));
    assert.ok(content.includes(suggestion.url));
  }
});
