import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import Fastify from "fastify";
import { config } from "@aihot/backend/config";
import { sql, type Tx } from "@aihot/backend/db";
import type { GuardedFetchOptions, GuardedResponse } from "@aihot/backend/lib/http-fetch";
import { refreshGitHubRanking, rankingCollector } from "../backend/collect.ts";
import { parseTrending, repositoryFromHref, TRENDING_URL } from "../backend/parse.ts";
import { rankingStore } from "../backend/store.ts";
import { githubRankingServer } from "../server.ts";
import type { GitHubRankingSnapshot } from "../types.ts";

const original = { enabled: process.env.COLLECT_ENABLED, token: process.env.GITHUB_TOKEN, model: config.modelCallsEnabled };
beforeEach(() => {
  process.env.COLLECT_ENABLED = "true";
  process.env.GITHUB_TOKEN = "test-github-token";
  config.modelCallsEnabled = false;
});
after(() => {
  if (original.enabled === undefined) delete process.env.COLLECT_ENABLED; else process.env.COLLECT_ENABLED = original.enabled;
  if (original.token === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = original.token;
  config.modelCallsEnabled = original.model;
});

const row = (repo: string, weekly = "120", stars = "2,345", description = "Official project description") =>
  `<article class="Box-row"><h2><a href="/${repo}">${repo}</a></h2><p>${description}</p><span itemprop="programmingLanguage">TypeScript</span><a href="/${repo}/stargazers">${stars}</a><span class="float-sm-right">${weekly} stars this week</span></article>`;
const response = (text: string, status = 200): GuardedResponse => ({ status, url: TRENDING_URL, headers: new Headers(), body: Buffer.from(text), truncated: false, text: () => text });
const snapshot = (html = row("acme/old")): GitHubRankingSnapshot => ({ fetchedAt: "2026-11-13T00:00:00.000Z", sourceUrl: TRENDING_URL, items: parseTrending(html) });
const metadata = (repo: string, description: string) => JSON.stringify({ full_name: repo, html_url: `https://github.com/${repo}`, private: false, description, language: "Rust", stargazers_count: 4567 });

test("repository links accept only canonical GitHub repository paths", () => {
  assert.equal(repositoryFromHref("/open-source/project.js"), "open-source/project.js");
  assert.equal(repositoryFromHref("https://github.com/acme/repo"), "acme/repo");
  for (const href of ["https://github.com.evil.test/a/b", "https://user:secret@github.com/a/b", "http://github.com/a/b", "//github.com/a/b", "/a/b?token=secret", "/a/b#readme", "/a/%2e%2e", "/a/../b", "/a/..", "/a/b\\evil", "/a/b/", "https://github.com:443/a/b"]) {
    assert.equal(repositoryFromHref(href), null, href);
  }
});

test("weekly counts, total-star ties, repository ties and case-insensitive duplicates rank deterministically", () => {
  const items = parseTrending(row("acme/z", "100", "9,000") + row("acme/c", "200", "800") + row("acme/b", "200", "900") + row("acme/a", "200", "900") + row("ACME/A", "199", "1,000"));
  assert.deepEqual(items.map(({ repo, rank }) => [repo, rank]), [["acme/a", 1], ["acme/b", 2], ["acme/c", 3], ["acme/z", 4]]);
  assert.equal(items[0].stars, 900);
  assert.equal(items[0].weeklyStars, 200);
  assert.equal(items[0].url, "https://github.com/acme/a");
  assert.equal(parseTrending(row("acme/zero", "0", "0"))[0].weeklyStars, 0);
  const untrusted = row("acme/allowed").replace('href="/acme/allowed"', 'href="https://evil.test/acme/allowed"');
  assert.deepEqual(parseTrending(untrusted + row("acme/safe")).map((item) => item.repo), ["acme/safe"]);
});

test("empty, changed or invalid-count listings fail instead of publishing a misleading empty chart", () => {
  for (const html of ["<html>Sign in</html>", row("acme/repo").replace("stars this week", "stars today"), row("acme/repo", "1,23"), row("acme/repo", "120", "1.2k"), row("../repo")]) {
    assert.throws(() => parseTrending(html), /GitHub Trending/);
  }
});

test("metadata failure preserves an existing Chinese description while a new repository keeps listing data", async (t) => {
  const old = snapshot(row("acme/old", "10", "100", "Official project description"));
  old.items[0].descriptionZh = "已有中文简介";
  t.mock.method(rankingStore, "load", async () => old);
  let published: GitHubRankingSnapshot | null = null;
  t.mock.method(rankingStore, "publish", async (value: GitHubRankingSnapshot) => { published = value; });
  const fetched = t.mock.method(rankingCollector, "fetch", async (url: string, options?: GuardedFetchOptions) => {
    if (url === TRENDING_URL) return response(row("acme/old", "300", "1,000") + row("acme/new", "200", "2,000"));
    assert.equal(new URL(url).origin, "https://api.github.com");
    assert.equal(options?.headers?.authorization, "Bearer test-github-token");
    assert.equal(options?.redirectPolicy, "same-origin");
    return response("Unavailable", 404);
  });
  const translate = t.mock.method(rankingCollector, "translate", async () => { throw new Error("model must remain off"); });
  const result = await refreshGitHubRanking();
  assert.equal(result.metadataFailures, 2);
  assert.equal(fetched.mock.callCount(), 3);
  assert.equal(translate.mock.callCount(), 0);
  assert.ok(published);
  const items = (published as GitHubRankingSnapshot).items;
  assert.equal(items[0].description, "Official project description");
  assert.equal(items[0].descriptionZh, "已有中文简介");
  assert.equal(items[0].weeklyStars, 300);
  assert.equal(items[0].stars, 1000);
  assert.equal(items[1].description, "Official project description");
  assert.equal(items[1].descriptionZh, null);
  assert.deepEqual(Object.keys(published).sort(), ["fetchedAt", "items", "sourceUrl"]);
  assert.ok(!JSON.stringify(published).includes("test-github-token"));
});

test("rate refusals or an exhausted API quota stop metadata requests and keep current listing descriptions", async (t) => {
  const old = snapshot(row("acme/old", "300", "100", "Outdated description") + row("acme/empty", "100", "100", "Previous nonempty description"));
  old.items.forEach((item) => { item.descriptionZh = "旧版中文简介"; });
  t.mock.method(rankingStore, "load", async () => old);
  let published: GitHubRankingSnapshot | null = null;
  t.mock.method(rankingStore, "publish", async (value: GitHubRankingSnapshot) => { published = value; });
  let status = 403;
  const fetched = t.mock.method(rankingCollector, "fetch", async (url: string) => {
    if (url === TRENDING_URL) return response(row("acme/old", "300", "1,000", "Current listing description") + row("acme/new", "200") + row("acme/empty", "100", "100", ""));
    const result = response(metadata("acme/old", "Current API description"), status);
    if (status === 200) result.headers.set("x-ratelimit-remaining", "0");
    return result;
  });
  for (status of [403, 429, 200]) {
    const before = fetched.mock.callCount();
    await refreshGitHubRanking();
    assert.equal(fetched.mock.callCount() - before, 2, "one listing and one API request only");
    assert.ok(published);
    const items: GitHubRankingSnapshot["items"] = (published as GitHubRankingSnapshot).items;
    assert.equal(items[0].description, status === 200 ? "Current API description" : "Current listing description");
    assert.equal(items[0].descriptionZh, null, "old Chinese text cannot describe a changed source");
    assert.equal(items.find((item) => item.repo === "acme/empty")?.descriptionZh, "旧版中文简介");
  }
});

test("only changed descriptions translate, including Japanese with Han characters, and the Chinese cache avoids repeat calls", async (t) => {
  config.modelCallsEnabled = true;
  let stored = snapshot(row("acme/old", "120", "2,345", "Unchanged description"));
  stored.items[0].descriptionZh = "未变化的中文简介";
  t.mock.method(rankingStore, "load", async () => stored);
  t.mock.method(rankingStore, "publish", async (next: GitHubRankingSnapshot, receiptId: number | null) => {
    assert.equal(receiptId, stored.items.length === 1 ? 42 : null);
    stored = next;
  });
  t.mock.method(rankingCollector, "fetch", async (url: string) => url === TRENDING_URL
    ? response(row("acme/old") + row("acme/new"))
    : response(metadata(url.split("/repos/")[1], url.endsWith("/old") ? "Unchanged description" : "高速な日本語の検索ライブラリ")));
  const translated = t.mock.method(rankingCollector, "translate", async (changed: Parameters<typeof rankingCollector.translate>[0]) => {
    assert.deepEqual(changed, [{ repo: "acme/new", description: "高速な日本語の検索ライブラリ" }]);
    return { data: { translations: [{ repo: "acme/new", descriptionZh: "高速日语搜索库" }] }, receiptId: 42, reused: false, model: "default", usage: null };
  });
  await refreshGitHubRanking();
  await refreshGitHubRanking();
  assert.equal(translated.mock.callCount(), 1);
  assert.equal(stored.items.find((item) => item.repo === "acme/old")?.descriptionZh, "未变化的中文简介");
  assert.equal(stored.items.find((item) => item.repo === "acme/new")?.descriptionZh, "高速日语搜索库");
});

test("a model failure still publishes official text, and a disabled collector performs no I/O", async (t) => {
  config.modelCallsEnabled = true;
  const load = t.mock.method(rankingStore, "load", async () => null);
  let published: GitHubRankingSnapshot | null = null;
  const publish = t.mock.method(rankingStore, "publish", async (value: GitHubRankingSnapshot, receiptId: number | null) => { assert.equal(receiptId, null); published = value; });
  const fetched = t.mock.method(rankingCollector, "fetch", async (url: string) => url === TRENDING_URL ? response(row("acme/new")) : response(metadata("acme/new", "Official fallback text")));
  const translated = t.mock.method(rankingCollector, "translate", async () => { throw new Error("model unavailable"); });
  assert.equal((await refreshGitHubRanking()).translationFailed, true);
  assert.ok(published);
  assert.equal((published as GitHubRankingSnapshot).items[0].description, "Official fallback text");
  assert.equal((published as GitHubRankingSnapshot).items[0].descriptionZh, null);
  process.env.COLLECT_ENABLED = "false";
  assert.deepEqual(await refreshGitHubRanking(), { updated: false });
  assert.deepEqual([load.mock.callCount(), fetched.mock.callCount(), translated.mock.callCount(), publish.mock.callCount()], [1, 2, 1, 1]);
});

test("fetch, listing validation and persistence failures leave the last snapshot untouched", async (t) => {
  const old = snapshot();
  t.mock.method(rankingStore, "load", async () => old);
  let text = "";
  let networkFailure = true;
  t.mock.method(rankingCollector, "fetch", async (url: string) => {
    if (networkFailure) throw new Error("network failed");
    return url === TRENDING_URL ? response(text) : response("not found", 404);
  });
  const publish = t.mock.method(rankingStore, "publish", async () => { throw new Error("database failed"); });
  await assert.rejects(refreshGitHubRanking(), /network failed/);
  networkFailure = false;
  await assert.rejects(refreshGitHubRanking(), /empty or its structure changed/);
  assert.equal(publish.mock.callCount(), 0);
  text = row("acme/new");
  await assert.rejects(refreshGitHubRanking(), /database failed/);
  assert.equal(old.items[0].repo, "acme/old");
  assert.equal(old.fetchedAt, "2026-11-13T00:00:00.000Z");
});

test("snapshot and model receipt completion share the publishing transaction", async (t) => {
  const queries: string[] = [];
  const tx = Object.assign(async (strings: TemplateStringsArray) => { queries.push(strings.join("?")); return []; }, { json: (value: unknown) => value });
  const transaction = t.mock.method(sql, "begin", async (run: (tx: Tx) => Promise<void>) => run(tx as unknown as Tx));
  await rankingStore.publish(snapshot(), 42);
  assert.equal(transaction.mock.callCount(), 1);
  assert.match(queries[0], /INSERT INTO settings/);
  assert.match(queries[1], /UPDATE receipts SET status = 'completed'/);
});

test("public HTTP reads only the persisted snapshot and marks missing or old snapshots stale", async (t) => {
  config.modelCallsEnabled = true;
  let saved: GitHubRankingSnapshot | null = null;
  t.mock.method(rankingStore, "load", async () => saved);
  const fetch = t.mock.method(rankingCollector, "fetch", async () => { throw new Error("public reads cannot collect"); });
  const translate = t.mock.method(rankingCollector, "translate", async () => { throw new Error("public reads cannot call models"); });
  const publish = t.mock.method(rankingStore, "publish", async () => { throw new Error("public reads cannot publish"); });
  const app = Fastify();
  githubRankingServer.http!(app);
  t.after(() => app.close());
  const missing = await app.inject({ url: "/api/site/github-ranking" });
  assert.equal(missing.statusCode, 200);
  assert.deepEqual(missing.json(), { snapshot: null, stale: true, refreshHours: 6 });
  saved = snapshot();
  saved.fetchedAt = new Date(Date.now() - 13 * 3600_000).toISOString();
  assert.equal((await app.inject({ url: "/api/site/github-ranking" })).json().stale, true);
  saved.fetchedAt = new Date().toISOString();
  const fresh = await app.inject({ url: "/api/site/github-ranking" });
  assert.deepEqual(fresh.json(), { snapshot: saved, stale: false, refreshHours: 6 });
  assert.match(String(fresh.headers["cache-control"]), /max-age=60/);
  assert.deepEqual([fetch.mock.callCount(), translate.mock.callCount(), publish.mock.callCount()], [0, 0, 0]);
  assert.equal(githubRankingServer.schedules?.[0].cron, "0 */6 * * *");
  process.env.COLLECT_ENABLED = "false";
  assert.equal(githubRankingServer.schedules?.[0].when?.(), false);
});
