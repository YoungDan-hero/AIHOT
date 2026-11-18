import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";

export const employeeLoginEnabled = () => process.env.FEISHU_EMPLOYEE_LOGIN_ENABLED === "true";

// The HTTP server and the bundled SSR app each load this module. Both need the same request context.
const contextKey = Symbol.for("aihot.employee-request-cookie");
const shared = globalThis as typeof globalThis & { [contextKey]?: AsyncLocalStorage<string> };
const cookies = (shared[contextKey] ??= new AsyncLocalStorage<string>());

export const employeeCookie = () => cookies.getStore();

export function withEmployeeCookie<T>(req: IncomingMessage, run: () => T): T {
  return employeeLoginEnabled() ? cookies.run(req.headers.cookie ?? "", run) : run();
}

export async function allowEmployeePage(req: IncomingMessage, res: ServerResponse, apiBase: string): Promise<boolean> {
  if (!employeeLoginEnabled()) return true;

  const writeHead = res.writeHead.bind(res);
  res.writeHead = ((status: number, messageOrHeaders?: string | OutgoingHttpHeaders, headers?: OutgoingHttpHeaders) => {
    const outgoing = typeof messageOrHeaders === "string" ? headers : messageOrHeaders;
    for (const [name, value] of Object.entries(outgoing ?? {})) if (value !== undefined) res.setHeader(name, value);
    res.removeHeader("Expires");
    res.removeHeader("Surrogate-Control");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Accel-Expires", "0");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    return typeof messageOrHeaders === "string" ? writeHead(status, messageOrHeaders) : writeHead(status);
  }) as typeof res.writeHead;

  if (req.headers.cookie) {
    const session = await fetch(`${apiBase}/api/employee/session`, {
      headers: { cookie: req.headers.cookie }, redirect: "manual", signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
    if (session?.status === 204) return true;
    if (session?.status !== 401) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("登录服务暂不可用，请稍后重试。");
      return false;
    }
  }

  const target = req.url ?? "/";
  const pathname = target.split("?", 1)[0]!;
  const dest = req.headers["sec-fetch-dest"];
  if ((req.method === "GET" || req.method === "HEAD") && !pathname.endsWith(".data") && pathname !== "/__manifest"
    && (!dest || dest === "document" || dest === "iframe")) {
    res.statusCode = 302;
    res.setHeader("Location", `/api/employee/login?${new URLSearchParams({ return: target })}`);
  } else {
    res.statusCode = 401;
  }
  res.end();
  return false;
}
