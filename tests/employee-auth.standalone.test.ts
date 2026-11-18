import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

const origin = "https://frontline.example.invalid";
const host = new URL(origin).host;
const tenant = "company-tenant";
process.env.SITE_URL = origin;
process.env.SESSION_SECRET = "employee-auth-test-signing-secret-only";
process.env.FEISHU_EMPLOYEE_LOGIN_ENABLED = "true";
process.env.FEISHU_EMPLOYEE_APP_ID = "cli_employee_test";
process.env.FEISHU_EMPLOYEE_APP_SECRET = "employee-test-app-secret";
process.env.FEISHU_EMPLOYEE_TENANT_KEY = tenant;
delete process.env.DEV_AUTH_ROLE;

const { buildApp } = await import("../apps/api/src/app.ts");

test("private access requires Feishu authorization by the configured tenant", async (t) => {
  const app = await buildApp();
  t.after(() => app.close());
  const get = (url: string, cookie = "") => app.inject({ url, headers: { host, cookie } });

  for (const url of ["/api/site/pool", "/api/v1/items", "/feed.xml", "/api/mcp", "/items/draft/markdown", "/api/employee/session"]) {
    const denied = await get(url);
    assert.equal(denied.statusCode, 401, url);
    assert.equal(denied.headers["cache-control"], "private, no-store");
  }
  const forged = await app.inject({ url: "/api/site/pool", headers: { host, "x-aihot-ssr": "1" } });
  assert.equal(forged.statusCode, 401);

  const target = "/all?channel=news";
  const login = "/api/employee/login?" + new URLSearchParams({ return: target });
  const start = await get(login);
  assert.equal(start.statusCode, 302);
  assert.match(start.headers["set-cookie"] as string, /HttpOnly; SameSite=Lax; Max-Age=300; Secure/);
  const flow = (start.headers["set-cookie"] as string).split(";")[0]!;
  const authorization = new URL(start.headers.location!);
  assert.equal(authorization.origin, "https://accounts.feishu.cn");
  assert.equal(authorization.searchParams.get("target_tenant"), tenant);
  assert.equal(authorization.searchParams.get("redirect_uri"), `${origin}/api/employee/callback`);
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  const state = authorization.searchParams.get("state");
  assert.ok(state);

  let loginTenant = "other-company";
  const outbound = t.mock.method(globalThis, "fetch", async (address: string, init: RequestInit) => {
    if (address === "https://open.feishu.cn/open-apis/authen/v2/oauth/token") {
      const request = JSON.parse(String(init.body));
      assert.equal(request.code, "fixture-code");
      const challenge = createHash("sha256").update(request.code_verifier).digest("base64url");
      assert.equal(challenge, authorization.searchParams.get("code_challenge"));
      return Response.json({ code: 0, access_token: "test-access-token" });
    }
    assert.equal(address, "https://open.feishu.cn/open-apis/authen/v1/user_info");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-access-token");
    return Response.json({ code: 0, data: { tenant_key: loginTenant, open_id: "ou_fixture" } });
  });

  const callback = (returnedState: string, cookie?: string) => get("/api/employee/callback?" + new URLSearchParams({ state: returnedState, code: "fixture-code" }), cookie);
  assert.equal((await callback("altered-state", flow)).statusCode, 403);
  assert.equal((await callback(state)).statusCode, 403);
  assert.equal(outbound.mock.callCount(), 0);

  const denied = await callback(state, flow);
  assert.equal(denied.statusCode, 403);
  assert.doesNotMatch(String(denied.headers["set-cookie"]), /aihot_employee=/);
  assert.match(denied.body, /href="\/api\/employee\/login\?/);

  loginTenant = tenant;
  const allowed = await callback(state, flow);
  assert.equal(allowed.statusCode, 303, allowed.body);
  assert.equal(allowed.headers.location, target);
  const cookies = allowed.headers["set-cookie"] as string[];
  assert.match(cookies.find((value) => value.startsWith("__Host-aihot_employee_flow=")) ?? "", /Max-Age=0/);
  const sessionHeader = cookies.find((value) => value.startsWith("__Host-aihot_employee="));
  assert.ok(sessionHeader);
  assert.match(sessionHeader, /HttpOnly; SameSite=Lax; Max-Age=7200; Secure/);
  const session = sessionHeader.split(";")[0]!;
  const alreadySignedIn = await get(login, session);
  assert.equal(alreadySignedIn.headers.location, target);
  assert.equal(alreadySignedIn.headers["set-cookie"], undefined);
  assert.equal((await get("/api/employee/session", session)).statusCode, 204);
  assert.equal((await get("/api/employee/session", session + "a")).statusCode, 401);
  assert.equal((await get("/api/employee/session", flow.replace("aihot_employee_flow=", "aihot_employee="))).statusCode, 401);
  assert.equal((await get("/api/admin/me", session)).statusCode, 401);

  const docs = await get("/openapi-v1.json", session);
  assert.equal(docs.statusCode, 200);
  assert.equal(docs.headers["cache-control"], "private, no-store");
  assert.equal(docs.headers["x-robots-tag"], "noindex, nofollow");

  const logout = (from: string) => app.inject({ method: "POST", url: "/api/employee/logout", headers: { host, origin: from, cookie: session } });
  assert.equal((await logout("https://outside.example.invalid")).statusCode, 403);
  const signedOut = await logout(origin);
  assert.equal(signedOut.statusCode, 200);
  assert.match(signedOut.body, /已退出短剧前线/);
  assert.equal(signedOut.headers.location, undefined);
  assert.match(signedOut.headers["set-cookie"] as string, /^__Host-aihot_employee=;.*Max-Age=0/);
});
