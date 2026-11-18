import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, test } from "node:test";
import type { EmployeeVisitsResponse } from "@aihot/contracts/site";

const origin = "https://frontline.example.invalid";
const host = new URL(origin).host;
const tenant = "test-company";
const appId = "cli_employee_visits_test";
const signingSecret = "employee-visits-test-signing-secret-only";
const owner = "ou_test_owner";

process.env.SITE_URL = origin;
process.env.SESSION_SECRET = signingSecret;
process.env.FEISHU_EMPLOYEE_LOGIN_ENABLED = "true";
process.env.FEISHU_EMPLOYEE_APP_ID = appId;
process.env.FEISHU_EMPLOYEE_APP_SECRET = "employee-visits-test-app-secret";
process.env.FEISHU_EMPLOYEE_TENANT_KEY = tenant;
process.env.FEISHU_OWNER_OPEN_ID = owner;
delete process.env.DEV_AUTH_ROLE;

const { buildApp } = await import("../apps/api/src/app.ts");
const { upsertMaterial } = await import("@aihot/backend/content/materials");
const { sql, closeDb } = await import("@aihot/backend/db");
const { installModules } = await import("@aihot/backend/modules");
const { publishArticle } = await import("@aihot/backend/publication/publish");
const { SERVER_MODULES } = await import("../site/modules/server.ts");
installModules(SERVER_MODULES);
after(async () => {
  installModules([]);
  await closeDb();
});

function sessionCookie(user: string, name?: string) {
  const payload = Buffer.from(JSON.stringify({ user, name, expires: Date.now() + 60_000 })).toString("base64url");
  const signature = createHmac("sha256", signingSecret)
    .update(JSON.stringify(["employee-auth-v1", "session", appId, tenant, origin, payload])).digest("base64url");
  return `__Host-aihot_employee=${payload}.${signature}`;
}

test("only the owner sees visit sessions grouped by verified Feishu account and inactivity", async (t) => {
  const app = await buildApp();
  t.after(() => app.close());

  const names: Record<string, string | undefined> = { [owner]: "路飞", ou_same_name: "路飞", ou_colleague: "\u202E  娜美\n" };
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/oauth/token")) {
      return Response.json({ code: 0, access_token: JSON.parse(String(init.body)).code });
    }
    assert.match(url, /\/user_info$/);
    const openId = new Headers(init.headers).get("authorization")!.slice(7);
    return Response.json({ code: 0, data: { tenant_key: tenant, open_id: openId, name: names[openId] } });
  });

  const get = (url: string, cookie = "") => app.inject({ url, headers: { host, cookie } });
  async function signIn(openId: string) {
    const login = await get("/api/employee/login");
    assert.equal(login.statusCode, 302);
    const flow = (login.headers["set-cookie"] as string).split(";")[0]!;
    const state = new URL(login.headers.location!).searchParams.get("state")!;
    const callback = await get("/api/employee/callback?" + new URLSearchParams({ code: openId, state }), flow);
    assert.equal(callback.statusCode, 303);
    const session = (callback.headers["set-cookie"] as string[]).find((value) => value.startsWith("__Host-aihot_employee="));
    assert.ok(session);
    return session.split(";")[0]!;
  }

  const [ownerCookie, sameNameCookie, colleagueCookie, missingNameCookie] = await Promise.all([
    signIn(owner), signIn("ou_same_name"), signIn("ou_colleague"), signIn("ou_missing_name"),
  ]);
  const profile = "/api/employee/profile";
  const visits = "/api/owner/visits";
  const modelRankings = "/api/owner/model-rankings";
  for (const url of [profile, visits, modelRankings]) assert.equal((await get(url)).statusCode, 401, url);
  assert.deepEqual((await get(profile, ownerCookie)).json(), { owner: true });
  assert.deepEqual((await get(profile, sameNameCookie)).json(), { owner: false });
  const rankings = await get(modelRankings, ownerCookie);
  assert.equal(rankings.statusCode, 200);
  assert.equal(rankings.headers["cache-control"], "private, no-store");
  assert.deepEqual(rankings.json(), { items: [], updatedAt: null });
  for (const url of [visits, modelRankings, visits.replace("visits", "%76isits")]) {
    assert.equal((await get(url, sameNameCookie)).statusCode, 403, url);
  }
  assert.equal((await get(visits, sameNameCookie + "a")).statusCode, 401);

  const oldCookie = sessionCookie(owner);
  assert.equal((await get(profile, oldCookie)).statusCode, 401);
  assert.equal(new URL((await get("/api/employee/login", oldCookie)).headers.location!).origin, "https://accounts.feishu.cn");

  const source = "employee-visit-fixture";
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode) VALUES (${source}, '测试信源', 'rss', 'T1', 'editorial')`;
  const { articleId } = await upsertMaterial({
    sourceId: source, url: "https://example.invalid/visit", title: "访客测试资讯",
    bodyText: "访客记录测试资讯正文。", bodyStatus: "ok", via: "fetch",
  });
  await publishArticle(articleId);

  const post = (path: string, cookie = colleagueCookie, from = origin) => app.inject({
    method: "POST", url: "/api/employee/visits", headers: { host, cookie, origin: from },
    payload: { path, name: "伪造花名", articleTitle: "伪造标题" },
  });
  const articlePath = `/items/${articleId}/original`;
  assert.equal((await post("/all", "")).statusCode, 401);
  assert.equal((await post("/all", colleagueCookie, "https://external.invalid")).statusCode, 403);
  for (const path of ["/all?token=secret", "/all#secret", "/owner/model-rankings", "/admin/content", "/api/employee/callback", "//external.invalid/all"])
    assert.equal((await post(path)).statusCode, 400, path);
  assert.equal((await post("/items/does-not-exist")).statusCode, 204);
  assert.equal((await post("/all", missingNameCookie)).statusCode, 204);
  assert.equal((await post("/weekly", ownerCookie)).statusCode, 204);
  assert.equal((await post("/hot", sameNameCookie)).statusCode, 204);
  assert.equal((await post("/all")).statusCode, 204);
  assert.equal((await post("/all", sessionCookie("ou_colleague", "娜美"))).statusCode, 204);
  assert.equal((await post(articlePath)).statusCode, 204);
  assert.equal((await post(`/items/${articleId}`)).statusCode, 204);

  async function records(url = visits) {
    const response = await get(url, ownerCookie);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "private, no-store");
    return response.json<EmployeeVisitsResponse>();
  }
  const initial = await records();
  assert.equal(initial.total, 4);
  assert.equal(initial.pageCount, 1);
  const [articleVisit] = initial.items;
  assert.equal(articleVisit?.name, "娜美");
  assert.equal(articleVisit.historical, false);
  assert.deepEqual(articleVisit.pages, [{ path: "/all", count: 2 }]);
  assert.deepEqual(articleVisit.articles, [{ path: `/items/${articleId}`, title: "访客测试资讯", count: 2 }]);
  assert.ok(Date.parse(articleVisit.lastVisitedAt) >= Date.parse(articleVisit.startedAt));
  const pageVisit = initial.items.find((entry) => entry.name === "飞书未返回花名");
  assert.deepEqual(pageVisit?.pages, [{ path: "/all", count: 1 }]);
  assert.deepEqual(initial.items.filter((entry) => entry.name === "路飞").map((entry) => entry.pages), [
    [{ path: "/hot", count: 1 }], [{ path: "/weekly", count: 1 }],
  ]);
  assert.doesNotMatch(JSON.stringify(initial), /ou_colleague|伪造|secret|account_key|[0-9a-f]{64}/);

  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${articleId}`;
  assert.equal((await post(articlePath)).statusCode, 204);
  const afterWithdrawal = await records();
  assert.equal(afterWithdrawal.total, 4);
  assert.deepEqual(afterWithdrawal.items[0]?.articles, [{ path: `/items/${articleId}`, title: null, count: 2 }]);

  const account = "e".repeat(64);
  await sql`
    INSERT INTO employee_visits (account_key, name, path, visited_at) VALUES
      (${account}, '会话测试', '/', '2001-01-01 12:00:00+00'),
      (${account}, '会话测试', '/', '2001-01-01 12:29:59+00'),
      (${account}, '会话测试', '/about', '2001-01-01 12:59:59+00'),
      (null, '娜美', '/starred', '2001-01-01 12:00:00+00'),
      (null, '娜美', '/starred', '2001-01-01 12:02:00+00'),
      (null, '飞书未返回花名', '/agent', '2001-01-01 12:00:00+00'),
      (null, '飞书未返回花名', '/agent', '2001-01-01 12:02:00+00')`;
  const withHistory = await records();
  assert.equal(withHistory.total, 9);
  const threshold = withHistory.items.filter((entry) => entry.name === "会话测试");
  assert.deepEqual(threshold.map(({ startedAt, lastVisitedAt, pages }) => ({ startedAt, lastVisitedAt, pages })), [
    { startedAt: "2001-01-01T12:59:59.000Z", lastVisitedAt: "2001-01-01T12:59:59.000Z", pages: [{ path: "/about", count: 1 }] },
    { startedAt: "2001-01-01T12:00:00.000Z", lastVisitedAt: "2001-01-01T12:29:59.000Z", pages: [{ path: "/", count: 2 }] },
  ]);
  const historicalColleague = withHistory.items.filter((entry) => entry.name === "娜美" && entry.historical);
  assert.equal(historicalColleague.length, 1);
  assert.deepEqual(historicalColleague[0]?.pages, [{ path: "/starred", count: 2 }]);
  assert.equal(withHistory.items.filter((entry) => entry.name === "飞书未返回花名" && entry.historical).length, 2);

  await sql`INSERT INTO employee_visits (name, path) SELECT '测试访客' || n, '/sources' FROM generate_series(1, 40) n`;
  const first = await records();
  assert.equal(first.total, 49);
  assert.equal(first.items.length, 40);
  const second = await records(`${visits}?page=2`);
  assert.equal(second.pageCount, 2);
  assert.equal(second.page, 2);
  assert.deepEqual(second.items, withHistory.items);
  assert.deepEqual(await records(`${visits}?page=999`), second);
});

test("owner APIs deny access with no configured Feishu owner or employee login disabled", async (t) => {
  delete process.env.FEISHU_OWNER_OPEN_ID;
  t.after(() => {
    process.env.FEISHU_OWNER_OPEN_ID = owner;
    process.env.FEISHU_EMPLOYEE_LOGIN_ENABLED = "true";
  });
  const headers = { host, cookie: sessionCookie(owner, "路飞") };
  const noOwner = await buildApp();
  t.after(() => noOwner.close());
  assert.deepEqual((await noOwner.inject({ url: "/api/employee/profile", headers })).json(), { owner: false });
  for (const url of ["/api/owner/visits", "/api/owner/model-rankings"])
    assert.equal((await noOwner.inject({ url, headers })).statusCode, 403, url);

  process.env.FEISHU_OWNER_OPEN_ID = owner;
  process.env.FEISHU_EMPLOYEE_LOGIN_ENABLED = "false";
  const disabled = await buildApp();
  t.after(() => disabled.close());
  for (const url of ["/api/owner/visits", "/api/owner/model-rankings"]) {
    const denied = await disabled.inject({ url, headers });
    assert.equal(denied.statusCode, 401, url);
    assert.equal(denied.headers["cache-control"], "private, no-store");
  }
});
