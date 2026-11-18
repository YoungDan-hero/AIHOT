import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import type { SourceDirectoryResponse } from "@aihot/contracts/site";
import { buildApp } from "../apps/api/src/app.ts";

const app = await buildApp();
after(async () => { await app.close(); await closeDb(); });

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
