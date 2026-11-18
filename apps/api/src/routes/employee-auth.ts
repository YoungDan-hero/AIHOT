import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { safeReturn } from "@aihot/contracts/admin";
import { config, credential } from "@aihot/backend/config";
import { cookie, parseCookies } from "@aihot/backend/lib/http-cookies";

const LOGIN = "/api/employee/login";
const CALLBACK = "/api/employee/callback";
const SESSION = "/api/employee/session";
const LOGOUT = "/api/employee/logout";
const STATE_AGE = 300;
const SESSION_AGE = 2 * 60 * 60;

type Flow = { expires: number; state: string; verifier: string; target: string };
type Session = { expires: number; user: string };

function signinPage(message: string, target = "/"): string {
  const next = LOGIN + "?" + new URLSearchParams({ return: target });
  return `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>飞书登录 · 短剧前线</title>
<style>
:root{color-scheme:light;font:16px system-ui,sans-serif;color:#102930;background:#f4f8f8}
body{margin:0;min-height:100vh;display:grid;place-items:center}
main{box-sizing:border-box;width:min(100% - 2rem,28rem);padding:2rem;border:1px solid #cddedd;background:#fff;border-radius:1rem}
h1{margin:0;font-size:1.75rem}
p{line-height:1.65;margin:1rem 0 1.5rem}
a{display:inline-block;background:#08646b;color:#fff;padding:.7rem 1.1rem;border-radius:.45rem;text-decoration:none;font-weight:600}
a:focus-visible{outline:2px solid #08646b;outline-offset:3px}
</style>
<main><h1>短剧前线</h1><p>${message}</p><a href="${next}">使用飞书登录</a></main></html>`;
}

export function registerEmployeeAuth(app: FastifyInstance): void {
  if (process.env.FEISHU_EMPLOYEE_LOGIN_ENABLED !== "true") return;

  const appId = credential("integrations", "FEISHU_EMPLOYEE_APP_ID");
  const appSecret = credential("integrations", "FEISHU_EMPLOYEE_APP_SECRET");
  const tenant = process.env.FEISHU_EMPLOYEE_TENANT_KEY;
  const secret = credential("auth", "SESSION_SECRET");
  const origin = new URL(config.siteUrl);
  const secure = origin.protocol === "https:";
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (!appId || !appSecret || !tenant || !secret || secret.length < 32 || config.devAdmin
      || origin.href !== origin.origin + "/" || !(secure || (origin.protocol === "http:" && local))) {
    throw new Error("Employee login requires FEISHU_EMPLOYEE_APP_ID, FEISHU_EMPLOYEE_APP_SECRET, FEISHU_EMPLOYEE_TENANT_KEY, a random SESSION_SECRET of at least 32 characters, and an HTTPS SITE_URL (HTTP loopback for local tests). DEV_AUTH_ROLE must be unset.");
  }
  const callback = origin.origin + CALLBACK;
  const sessionCookie = secure ? "__Host-aihot_employee" : "aihot_employee";
  const stateCookie = secure ? "__Host-aihot_employee_flow" : "aihot_employee_flow";
  const signature = (kind: string, payload: string) => createHmac("sha256", secret)
    .update(JSON.stringify(["employee-auth-v1", kind, appId, tenant, origin.origin, payload])).digest();
  const sign = (kind: string, value: Session | Flow) => {
    const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
    return payload + "." + signature(kind, payload).toString("base64url");
  };
  const read = <T extends Flow | Session>(kind: string, value: string | undefined): T | null => {
    const parts = value?.split(".");
    if (parts?.length !== 2 || !/^[\w-]+$/.test(parts[0]!) || !/^[\w-]{43}$/.test(parts[1]!)) return null;
    const [payload, signed] = parts as [string, string];
    if (!timingSafeEqual(signature(kind, payload), Buffer.from(signed, "base64url"))) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as T;
    return data.expires > Date.now() ? data : null;
  };

  // Every data route, including direct API requests, shares this gate. Ingest keeps its own token check.
  app.addHook("onRequest", async (req, reply) => {
    const pathname = (req.raw.url ?? "").split("?")[0];
    if ((req.method === "GET" || req.method === "HEAD")
        && (pathname === LOGIN || pathname === CALLBACK || pathname === "/api/health")) return;
    if (req.method === "POST" && pathname === "/api/ingest/items") return;
    if (!read<Session>("session", parseCookies(req.headers.cookie)[sessionCookie])) {
      return reply.code(401).send({ error: "employee_login_required" });
    }
  });
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("Cache-Control", "private, no-store");
    reply.header("X-Accel-Expires", "0");
    reply.header("X-Robots-Tag", "noindex, nofollow");
    reply.removeHeader("expires");
    reply.removeHeader("surrogate-control");
    return payload;
  });

  type ReturnQuery = { Querystring: { return?: string } };
  app.get<ReturnQuery>(LOGIN, { exposeHeadRoute: false }, async (req, reply) => {
    const target = safeReturn(req.query.return || "/");
    if (req.headers.host !== origin.host) return reply.redirect(origin.origin + LOGIN + "?" + new URLSearchParams({ return: target }));
    if (read<Session>("session", parseCookies(req.headers.cookie)[sessionCookie])) return reply.redirect(target);
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const flow = sign("flow", { expires: Date.now() + STATE_AGE * 1000, state, verifier, target });
    const params = new URLSearchParams({
      client_id: appId, redirect_uri: callback, response_type: "code", state, target_tenant: tenant,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    });
    return reply.header("Set-Cookie", cookie(stateCookie, flow, STATE_AGE, secure))
      .header("Referrer-Policy", "no-referrer")
      .redirect("https://accounts.feishu.cn/open-apis/authen/v1/authorize?" + params);
  });
  app.get<{ Querystring: { code?: string; state?: string } }>(CALLBACK, { exposeHeadRoute: false }, async (req, reply) => {
    const { code, state } = req.query;
    const flow = read<Flow>("flow", parseCookies(req.headers.cookie)[stateCookie]);
    const clear = cookie(stateCookie, "", 0, secure);
    reply.header("Set-Cookie", clear).header("Referrer-Policy", "no-referrer");
    if (req.headers.host !== origin.host || !flow || !state || state !== flow.state || typeof code !== "string" || !code || code.length > 1024) {
      return reply.code(403).type("text/html; charset=utf-8").send(signinPage("授权未完成或登录链接已失效，请重新登录。", flow?.target));
    }
    try {
      const tokenResponse = await fetch("https://open.feishu.cn/open-apis/authen/v2/oauth/token", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code", client_id: appId, client_secret: appSecret,
          redirect_uri: callback, code, code_verifier: flow.verifier,
        }),
      });
      const token = await tokenResponse.json() as { code?: number; access_token?: unknown };
      if (!tokenResponse.ok || token.code !== 0 || typeof token.access_token !== "string" || !token.access_token) {
        return reply.code(403).type("text/html; charset=utf-8").send(signinPage("飞书未能确认这次授权，请检查应用可用范围后重试。", flow.target));
      }
      const profileResponse = await fetch("https://open.feishu.cn/open-apis/authen/v1/user_info", {
        headers: { Authorization: "Bearer " + token.access_token },
        redirect: "error", signal: AbortSignal.timeout(10_000),
      });
      const profile = await profileResponse.json() as { code?: number; data?: { tenant_key?: string; open_id?: string } };
      const user = profile.data?.open_id;
      if (!profileResponse.ok || profile.code !== 0 || profile.data?.tenant_key !== tenant || typeof user !== "string" || !/^ou_[\w-]{1,253}$/.test(user)) {
        return reply.code(403).type("text/html; charset=utf-8").send(signinPage("请切换到重庆麦芽传媒有限公司的飞书账号后重试。", flow.target));
      }
      const session = sign("session", { user, expires: Date.now() + SESSION_AGE * 1000 });
      return reply.header("Set-Cookie", cookie(sessionCookie, session, SESSION_AGE, secure)).redirect(flow.target, 303);
    } catch {
      // Provider errors can include response bytes or authorization parameters.
      return reply.code(503).type("text/html; charset=utf-8").send(signinPage("暂时无法连接飞书，请稍后重试。", flow.target));
    }
  });
  app.get(SESSION, async (_req, reply) => reply.code(204).send());
  app.post(LOGOUT, async (req, reply) => {
    if (req.headers.origin !== origin.origin) return reply.code(403).send({ error: "forbidden" });
    return reply.header("Set-Cookie", cookie(sessionCookie, "", 0, secure))
      .type("text/html; charset=utf-8").send(signinPage("已退出短剧前线。"));
  });
}
