import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { FIXTURE_AT, fakeApi, itemDetail, startWebServer, visit } from "./web-server.ts";

test("employee favorites sync between desktop and phone, with separate accounts and no local import", async (t) => {
  const item = itemDetail({ id: "employee-favorites-fixture", title: "收藏同步测试文章" });
  const favorite = {
    id: item.id, title: item.title, summary: item.summary, sourceName: item.source.name,
    savedAt: FIXTURE_AT, publishedAt: item.publishedAt, score: item.score, aiSelected: item.selected, status: "public",
  };
  const saved = new Set<string>();
  const api = fakeApi((url, res, req) => {
    const account = /\baihot_employee=(first|second)(?:;|$)/.exec(req.headers.cookie ?? "")?.[1];
    if (url.pathname === "/api/employee/session") {
      res.statusCode = account ? 204 : 401;
      return res.end();
    }
    if (url.pathname === "/api/employee/starred") return { items: account && saved.has(account) ? [favorite] : [] };
    if (url.pathname === `/api/employee/starred/${item.id}` && account) {
      if (req.method === "PUT") saved.add(account);
      else if (req.method === "DELETE") saved.delete(account);
      else return;
      res.statusCode = 204;
      return res.end();
    }
    if (url.pathname === `/api/site/items/${item.id}`) return item;
  });
  const web = await startWebServer(api, { FEISHU_EMPLOYEE_LOGIN_ENABLED: "true" });
  t.after(() => web.stop());
  const browser = await chromium.launch({ channel: "chromium" });
  t.after(() => browser.close());

  const device = async (account: string, options: { viewport: { width: number; height: number }; isMobile?: boolean }) => {
    const context = await browser.newContext(options);
    await context.addCookies([{ name: "aihot_employee", value: account, url: web.origin, httpOnly: true }]);
    return context;
  };
  const desktopSize = { viewport: { width: 1366, height: 900 } };
  const desktop = await device("first", desktopSize);
  const phone = await device("first", { viewport: { width: 393, height: 852 }, isMobile: true });
  const colleague = await device("second", desktopSize);
  await phone.addInitScript((old) => {
    localStorage.setItem("aihot-starred-items", JSON.stringify([old]));
  }, { ...favorite, id: "old-local-favorite", title: "旧浏览器收藏" });
  const desktopPage = await desktop.newPage();
  const phonePage = await phone.newPage();
  const colleaguePage = await colleague.newPage();

  await visit(phonePage, web.origin + "/starred");
  await expect(phonePage.getByText("还没有收藏内容。", { exact: false })).toBeVisible();
  await expect(phonePage.getByText("旧浏览器收藏")).toHaveCount(0);

  await visit(desktopPage, web.origin + `/items/${item.id}`);
  const add = desktopPage.getByRole("button", { name: "收藏", exact: true }).filter({ visible: true });
  await add.click();
  await expect(desktopPage.getByRole("button", { name: "取消收藏", exact: true }).filter({ visible: true })).toHaveAttribute("aria-pressed", "true");
  assert.deepEqual([...saved], ["first"]);

  await phonePage.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(phonePage.getByRole("link", { name: item.title, exact: true })).toBeVisible();
  await visit(colleaguePage, web.origin + "/starred");
  await expect(colleaguePage.getByText("还没有收藏内容。", { exact: false })).toBeVisible();

  await phonePage.getByRole("button", { name: "取消收藏", exact: true }).click();
  await expect(phonePage.getByText("还没有收藏内容。", { exact: false })).toBeVisible();
  assert.equal(saved.size, 0);
  await visit(desktopPage, web.origin + "/starred");
  await expect(desktopPage.getByText("还没有收藏内容。", { exact: false })).toBeVisible();
});
