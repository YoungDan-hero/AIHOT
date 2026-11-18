import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { EmployeeStarredResponse } from "@aihot/contracts/site";

const origin = "https://frontline.example.invalid";
const host = new URL(origin).host;
const tenant = "test-company";
process.env.SITE_URL = origin;
process.env.SESSION_SECRET = "employee-starred-test-signing-secret-only";
process.env.FEISHU_EMPLOYEE_LOGIN_ENABLED = "true";
process.env.FEISHU_EMPLOYEE_APP_ID = "cli_employee_starred_test";
process.env.FEISHU_EMPLOYEE_APP_SECRET = "employee-starred-test-app-secret";
process.env.FEISHU_EMPLOYEE_TENANT_KEY = tenant;
delete process.env.DEV_AUTH_ROLE;

const { buildApp } = await import("../apps/api/src/app.ts");
const { upsertMaterial } = await import("@aihot/backend/content/materials");
const { sql, closeDb } = await import("@aihot/backend/db");
const { publishArticle } = await import("@aihot/backend/publication/publish");
after(closeDb);

test("employee favorites follow the verified account across sessions and keep each account isolated", async (t) => {
  const app = await buildApp();
  t.after(() => app.close());
  const source = "employee-starred-source";
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode)
    VALUES (${source}, '测试信源（内部备注）', 'rss', 'T1', 'editorial')`;
  const article = await upsertMaterial({
    sourceId: source, url: "https://example.invalid/bookmark", title: "新闻标题",
    bodyText: "这篇资讯用来验证飞书身份对应的收藏。", bodyStatus: "ok", via: "fetch",
  });
  const id = article.articleId;
  await publishArticle(id);

  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/oauth/token")) {
      return Response.json({ code: 0, access_token: JSON.parse(String(init.body)).code });
    }
    assert.ok(url.endsWith("/user_info"));
    const openId = new Headers(init.headers).get("authorization")?.slice(7);
    return Response.json({ code: 0, data: { tenant_key: tenant, open_id: openId } });
  });
  async function signIn(openId: string): Promise<string> {
    const login = await app.inject({ url: "/api/employee/login", headers: { host } });
    assert.equal(login.statusCode, 302);
    const flow = (login.headers["set-cookie"] as string).split(";")[0]!;
    const state = new URL(login.headers.location!).searchParams.get("state")!;
    const callback = await app.inject({
      url: "/api/employee/callback?" + new URLSearchParams({ code: openId, state }),
      headers: { host, cookie: flow },
    });
    assert.equal(callback.statusCode, 303);
    const session = (callback.headers["set-cookie"] as string[]).find((value) => value.startsWith("__Host-aihot_employee="));
    assert.ok(session);
    return session.split(";")[0]!;
  }
  const desktop = await signIn("ou_test_alice");
  const phone = await signIn("ou_test_alice");
  const colleague = await signIn("ou_test_bob");
  const path = "/api/employee/starred";
  const itemPath = path + "/" + id;

  async function list(cookie: string, url = path) {
    const reply = await app.inject({ url, headers: { host, cookie } });
    assert.equal(reply.statusCode, 200);
    assert.equal(reply.headers["cache-control"], "private, no-store");
    return reply.json<EmployeeStarredResponse>().items;
  }
  const write = (method: "PUT" | "DELETE", cookie: string, url = itemPath, from = origin) =>
    app.inject({ method, url, headers: { host, cookie, origin: from } });

  assert.equal((await app.inject({ url: path, headers: { host } })).statusCode, 401);
  assert.equal((await write("PUT", "")).statusCode, 401);
  assert.equal((await write("PUT", desktop, itemPath, "https://foreign.invalid")).statusCode, 403);
  assert.equal((await write("PUT", desktop, path + "/%20")).statusCode, 400);
  assert.equal((await write("PUT", desktop, path + "/missing")).statusCode, 404);
  assert.deepEqual(await list(phone), []);

  assert.equal((await write("PUT", desktop)).statusCode, 204);
  const [saved] = await list(phone);
  assert.equal(saved?.id, id);
  assert.equal(saved?.title, "新闻标题");
  assert.equal(saved?.sourceName, "测试信源");
  assert.equal((await write("PUT", phone)).statusCode, 204);
  assert.deepEqual(await list(desktop), [saved]);
  assert.deepEqual(await list(colleague, path + "?account=ou_test_alice"), []);
  assert.equal((await write("DELETE", colleague)).statusCode, 204);
  assert.deepEqual(await list(desktop), [saved]);

  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${id}`;
  assert.equal((await write("PUT", colleague)).statusCode, 404);
  const [withdrawn] = await list(phone);
  assert.equal(withdrawn?.status, "unavailable");
  assert.notEqual(withdrawn?.title, saved?.title);
  assert.equal(withdrawn?.summary, null);
  assert.equal((await write("DELETE", phone)).statusCode, 204);
  assert.equal((await write("DELETE", phone)).statusCode, 204);
  assert.deepEqual(await list(desktop), []);
});
