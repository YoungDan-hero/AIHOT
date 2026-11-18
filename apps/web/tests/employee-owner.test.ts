import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { FIXTURE_AT, fakeApi, itemDetail, startWebServer, visit } from "./web-server.ts";

test("owner records and model rankings require the owner account and record committed visits", async (t) => {
  const article = itemDetail({ id: "visitor-record-fixture", title: "访问记录测试文章" });
  const articlePath = `/items/${article.id}`;
  const models = Array.from({ length: 41 }, (_, index) => ({
    id: `model-${index}`,
    name: index === 0 ? "Example Model (Maximum)" : `Example Model ${index + 1} (High)`,
    score: 99.123456 - index,
    indexVersion: "5",
    icon: index === 0 ? "/model-logos/test-brand.svg" : index === 1 ? "https://example.invalid/not-a-local-icon.svg" : undefined,
  }));
  const tracked: Array<{ name: string; path: string; payload: Record<string, unknown>; referer?: string }> = [];
  const api = fakeApi(async (url, res, req) => {
    const account = /\baihot_employee=(owner|colleague)(?:;|$)/.exec(req.headers.cookie ?? "")?.[1];
    if (url.pathname === "/api/employee/session") {
      res.statusCode = account ? 204 : 401;
      return res.end();
    }
    if (url.pathname === "/api/employee/profile") return { owner: account === "owner" };
    if (url.pathname === "/api/employee/starred") {
      return { items: account === "colleague" ? [{
        id: article.id, title: article.title, summary: article.summary, sourceName: article.source.name,
        savedAt: FIXTURE_AT, publishedAt: article.publishedAt, score: article.score, aiSelected: article.selected, status: "public",
      }] : [] };
    }
    if (url.pathname === "/api/employee/visits" && account && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += String(chunk);
      const payload = JSON.parse(body) as Record<string, unknown>;
      tracked.push({ name: account === "owner" ? "路飞" : "同事花名", path: payload.path as string, payload, referer: req.headers.referer });
      res.statusCode = 204;
      return res.end();
    }
    if (url.pathname.startsWith("/api/owner/") && account !== "owner") {
      res.statusCode = account ? 403 : 401;
      return res.end();
    }
    if (url.pathname === "/api/owner/visits") {
      const visits = tracked.filter(({ name }) => name === "同事花名");
      const count = (path: string) => visits.filter((entry) => entry.path === path).length;
      return {
        page: 1, pageCount: 1, total: 2,
        items: [
          {
            id: "current", name: "同事花名", startedAt: FIXTURE_AT, lastVisitedAt: "2026-10-04T08:07:00.000Z", historical: false,
            pages: ["/more", "/starred"].map((path) => ({ path, count: count(path) })),
            articles: [{ path: articlePath, title: article.title, count: count(articlePath) }],
          },
          {
            id: "historical", name: "旧访客", startedAt: FIXTURE_AT, lastVisitedAt: FIXTURE_AT, historical: true,
            pages: [], articles: [{ path: "/items/withdrawn", title: null, count: 1 }],
          },
        ],
      };
    }
    if (url.pathname === "/api/owner/model-rankings") return { items: models, updatedAt: FIXTURE_AT };
    if (url.pathname === `/api/site/items/${article.id}`) return article;
  });
  const web = await startWebServer(api, { FEISHU_EMPLOYEE_LOGIN_ENABLED: "true" });
  t.after(() => web.stop());
  const browser = await chromium.launch({ channel: "chromium" });
  t.after(() => browser.close());

  const colleague = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await colleague.addCookies([{ name: "aihot_employee", value: "colleague", url: web.origin, httpOnly: true }]);
  const colleaguePage = await colleague.newPage();
  await visit(colleaguePage, web.origin + "/more?entry=secret#fragment");
  await expect(colleaguePage.locator('a[href="/owner/visits"], a[href="/owner/model-rankings"]')).toHaveCount(0);
  await expect.poll(() => tracked.map((entry) => entry.path)).toEqual(["/more"]);
  await colleaguePage.getByRole("main").getByRole("link", { name: /^收藏/ }).click();
  await expect.poll(() => tracked.map((entry) => entry.path)).toEqual(["/more", "/starred"]);
  await colleaguePage.getByRole("link", { name: article.title, exact: true }).click();
  await expect.poll(() => tracked.map((entry) => entry.path)).toEqual(["/more", "/starred", articlePath]);
  await colleaguePage.goBack();
  await expect.poll(() => tracked.map((entry) => entry.path)).toEqual(["/more", "/starred", articlePath, "/starred"]);
  await colleaguePage.getByRole("link", { name: article.title, exact: true }).click();
  await expect.poll(() => tracked.map((entry) => entry.path)).toEqual(["/more", "/starred", articlePath, "/starred", articlePath]);
  assert.ok(tracked.every(({ payload, referer, path }) => Object.keys(payload).length === 1 && payload.path === path && referer === undefined));

  for (const path of ["/owner/visits", "/owner/model-rankings"]) {
    const response = await colleague.request.get(web.origin + path);
    assert.equal(response.status(), 404);
    assert.equal(response.headers()["cache-control"], "private, no-store");
    assert.doesNotMatch(await response.text(), /访问记录测试文章|Example Model/);
    const anonymous = await fetch(web.origin + path, { redirect: "manual" });
    assert.equal(anonymous.status, 302);
  }

  const desktop = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await desktop.addCookies([{ name: "aihot_employee", value: "owner", url: web.origin, httpOnly: true }]);
  const ownerPage = await desktop.newPage();
  await visit(ownerPage, web.origin + "/owner/visits");
  await expect(ownerPage.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "访客记录" })).toBeVisible();
  const visits = ownerPage.getByRole("list", { name: "访问列表" });
  await expect(visits.locator("summary")).toHaveCount(2);
  const summary = visits.locator("summary", { hasText: "同事花名" });
  await expect(summary).toContainText("2026-10-04 16:00 – 16:07");
  await expect(summary).toContainText("2 个页面 · 1 篇资讯");
  const articleLink = visits.getByRole("link", { name: article.title, exact: true });
  await expect(articleLink).toBeHidden();
  await summary.press("Enter");
  await expect(articleLink).toBeVisible();
  await expect(articleLink).toHaveAttribute("href", articlePath);
  await expect(visits.getByText("收藏", { exact: false }).filter({ hasText: "×2" })).toBeVisible();
  await expect(articleLink.locator("..")).toContainText("×2");
  await summary.press("Enter");
  await expect(articleLink).toBeHidden();
  await expect(ownerPage.getByText("历史记录按当时的飞书花名归组。")).toBeVisible();
  await visits.locator("summary", { hasText: "旧访客" }).click();
  await expect(visits.getByText("资讯已不可用")).toBeVisible();

  const mobile = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true });
  await mobile.addCookies([{ name: "aihot_employee", value: "owner", url: web.origin, httpOnly: true }]);
  for (const context of [desktop, mobile]) {
    await context.route("**/model-logos/test-brand.svg", (route) => route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>',
    }));
  }
  await visit(ownerPage, web.origin + "/owner/model-rankings");
  await expect(ownerPage.getByRole("rowheader", { name: "Example Model (Maximum)", exact: true }).locator('img[alt=""]')).toBeVisible();

  const phone = await mobile.newPage();
  await visit(phone, web.origin + "/more");
  await phone.getByRole("link", { name: "访客记录" }).click();
  await expect(phone.getByRole("heading", { name: "访客记录" })).toBeVisible();
  await phone.getByRole("list", { name: "访问列表" }).locator("summary", { hasText: "同事花名" }).click();
  await expect(phone.getByRole("link", { name: article.title })).toBeVisible();
  await visit(phone, web.origin + "/more");
  await phone.getByRole("link", { name: "模型能力榜" }).click();
  await expect(phone.getByRole("heading", { name: "模型能力榜" })).toBeVisible();
  await expect(phone.getByRole("link", { name: "数据来源：Artificial Analysis" })).toHaveAttribute("href", "https://artificialanalysis.ai/");
  await expect(phone.getByText("2026-10-04 16:00（北京时间）")).toBeVisible();
  const first = phone.getByRole("row").filter({ hasText: "Example Model (Maximum)" });
  await expect(first).toContainText("99.123456");
  await expect(first).toContainText("v5");
  const name = first.getByRole("rowheader", { name: "Example Model (Maximum)", exact: true });
  const logo = name.locator('img[alt=""]');
  await expect(logo).toHaveAttribute("src", "/model-logos/test-brand.svg");
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(24);
  const unsafe = phone.getByRole("rowheader", { name: "Example Model 2 (High)", exact: true });
  await expect(unsafe.locator("img")).toHaveCount(0);
  await expect(unsafe.locator("[aria-hidden=true]")).toHaveText("E");
  await phone.getByRole("link", { name: "下一页" }).click();
  const last = phone.getByRole("row").filter({ hasText: "Example Model 41 (High)" });
  await expect(last.getByRole("cell", { name: "41", exact: true })).toBeVisible();
  await expect(last.getByRole("rowheader").locator("[aria-hidden=true]")).toHaveText("E");
  assert.ok(tracked.every(({ path }) => !path.startsWith("/owner/")));
});
