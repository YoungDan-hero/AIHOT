// Listing parsers on the page shapes Jina returns for real sites: card links that wrap an image, a title
// attribute, http links under https prefixes, and navigation that is no post. Also what made articles
// flip between versions: in-page anchors of an HTML listing and
// promotions a feed rotates inside its posts. A Next.js flight payload whose posts carry arrays of their
// own (LMSYS "categories":["sglang"]) was cut at the first "]" and read as no posts. A site that negotiates
// its language (Cursor) sent our default Chinese preference to its translation: a source's own language
// must reach every read of it.
import "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { config } from "@aihot/backend/config";
import { extractFromUrl, pageRules, readableDocument } from "@aihot/backend/content/extract";
import { contentDocument } from "@aihot/backend/lib/page-content";
import { sanitizeBody, trimTrailingChrome } from "@aihot/backend/content/sanitize";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";
import { fetchDetail, fetchWebList, fromHtml, fromMarkdown } from "@aihot/backend/sources/web-list";
import { fetchRss } from "@aihot/backend/sources/rss";
import { fetchJsonList } from "@aihot/backend/sources/json-list";
import { noiseFiltered } from "@aihot/backend/sources/filters";

const source = (config: Record<string, unknown>) => ({ id: "test-list", config }) as never;

test("JCMS lists read only XML records and retain source URL restrictions", () => {
  const url = "https://news.example.gov.cn/col/col42/index.html";
  const config = {
    url, parseMode: "html", adapter: "jcms_records", itemSelector: "li",
    allowUrlPrefixes: ["https://news.example.gov.cn/art/"], publishedAtSelector: "time", publishedAtUtcOffset: "+08:00",
  };
  const html = `
    <li><a href="/art/navigation.html">站内导航入口</a></li>
    <script type="text/xml"><datastore>
      <nextgroup><![CDATA[<li><a href="/art/next.html">下一页</a></li>]]></nextgroup>
      <recordset>
        <record><![CDATA[<li><a href="/art/first.html">原创微短剧产业动态</a><time>2026-11-18</time></li>]]></record>
        <record><![CDATA[<li><a href="https://elsewhere.example/art/other.html">外站文章</a></li>]]></record>
        <record><![CDATA[<li><a href="/art/first.html">重复文章</a></li>]]></record>
      </recordset>
    </datastore></script>`;
  assert.deepEqual(unsupportedConfig("web_list", config), []);
  assert.deepEqual(fromHtml(html, url, source(config)).map(({ url, title, publicationTime }) => [url, title, publicationTime]), [
    ["https://news.example.gov.cn/art/first.html", "原创微短剧产业动态", "2026-11-18"],
  ]);
});

test("inline change entries keep their own anchors, dates and sanitized bodies", () => {
  const url = "https://example.org/changelog/";
  const config = {
    url, preserveUrlFragment: true, itemSelector: "details", titleSelector: "summary span",
    publishedAtSelector: "time", publishedAtUtcOffset: "+08:00", inlineBodySelector: ".body",
  };
  const item = (id: string, date: string, body: string) => `<details id="${id}">
    <summary><span>短剧制作更新</span><time>${date}</time></summary><div class="body">${body}</div></details>`;
  const html = item("release-a", "2026-11-16", "<p>分镜工具更新</p><script>alert(1)</script>")
    + item("release-b", "2026-11-17", "<p>竖屏字幕更新</p>")
    + item("release-a", "2026-11-16", "<p>重复的条目</p>")
    + item("release-c", "未知日期", "<p>没有发布日期</p>");
  assert.deepEqual(unsupportedConfig("web_list", config), []);
  assert.deepEqual(unsupportedConfig("web_list", { ...config, preserveUrlFragment: false }), ["inlineBodySelector"]);
  assert.deepEqual(fromHtml(html, url, source(config)).map(({ url, identityKey, publicationTime, bodyHtml }) => [url, identityKey, publicationTime, bodyHtml]), [
    [`${url}#release-a`, `url:${url}#release-a`, "2026-11-16", "<p>分镜工具更新</p>"],
    [`${url}#release-b`, `url:${url}#release-b`, "2026-11-17", "<p>竖屏字幕更新</p>"],
  ]);
});

const pages: Record<string, () => string> = {
  // A news site's feed: a teaser that ends in "Read the full story", next to a post whose feed carries it whole.
  "/teaser.xml": () =>
    `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">` +
    `<entry><title>AMD is acquiring World Labs</title><link rel="alternate" href="https://example.org/amd-world-labs"/><published>2026-09-28T17:31:35-04:00</published>` +
    `<summary type="html">AMD announced today that it's acquiring World Labs.</summary>` +
    `<content type="html"><![CDATA[<p>${"AMD announced today that it is acquiring World Labs in an all-stock deal. ".repeat(8)}</p><p>Read the full story at Example News.</p>]]></content></entry>` +
    `<entry><title>A whole post</title><link rel="alternate" href="https://example.org/whole"/><published>2026-09-28T10:00:00Z</published>` +
    `<content type="html"><![CDATA[<p>${"The feed carries this post whole, paragraph after paragraph. ".repeat(30)}</p>]]></content></entry></feed>`,
  // A podcast whose feed summary is the whole episode note, in RSS and in Atom.
  "/notes.xml": () =>
    `<?xml version="1.0"?><rss version="2.0"><channel><title>Show</title><item><title>Episode 42</title><link>https://example.org/episodes/42</link>` +
    `<pubDate>Wed, 30 Sep 2026 00:00:00 GMT</pubDate><description>How leaders build confidence with their team.</description></item></channel></rss>`,
  "/notes.atom": () =>
    `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Episode 42</title><link rel="alternate" href="https://example.org/episodes/42"/>` +
    `<published>2026-09-30T00:00:00Z</published><summary type="html">How leaders build confidence with their team.</summary></entry></feed>`,
  // A list API that gives wall-clock times without a zone, and a page whose metadata does too.
  "/zoneless.json": () => JSON.stringify({ result: [{ id: "a", title: "采购公告", publishDate: "2026-09-30 17:43:58" }, { id: "b", title: "Zoned", publishDate: "2026-09-30T17:43:58Z" }, { id: "c", title: "Abbreviated zone", publishDate: "Wed, 30 Sep 2026 17:43:58 EST" }] }),
  "/zoneless-post": () => `<html><head><meta property="article:published_time" content="2026-09-30 17:43:58"></head><body><p>Post</p></body></html>`,
  "/typed-dates": () => '<html><body><span data-article-publish-time="1793009118"></span><time>04-11-2026</time><i>31-02-2026</i><b>06.11.2026</b></body></html>',
  "/split-date": () => '<div class="ldate"><p>2026</p>\n<p>05/19</p>\n<p>08:05</p><script>counter(123)</script><p>来源 无锡日报 分享</p></div><div class="related"><p>other post 2025</p><p>05/19</p><p>08:05</p></div>',
  "/json5-news": () => "var newsData = [/* bracket ] and quotes ' */ { title: '微短剧行业报告', url: 'https://example.org/a', }, // ]\n {title:'短剧合作动态',url:'https://example.org/b'}]; globalThis.newsDataExecuted = true;",
  "/not-data-news": () => 'var newsData = [{ title: (() => { globalThis.newsDataExecuted = true; return "short drama"; })(), url: "https://example.org/a" }];',
  "/paperindex.htm": () => '<META HTTP-EQUIV="REFRESH" CONTENT="0; URL=html/2026-11/13/node_1.htm?v=1">',
  "/epaper/": () => '<script>window.parent.location.href="2026/11/18/page_list_20261118.html"</script>',
  "/epaper/2026/11/18/page_list_20261118.html": () => '<a href="article_list_20261118.html">按文章阅读</a><area href="article_detail_1_20261118A031.html">',
  "/epaper/2026/11/18/article_list_20261118.html": () => '<a href="article_detail_1_20261118A031.html">微短剧行业观察</a>',
  "/html/2026-11/13/node_1.htm?v=1": () => '<a href="content_123.htm">短剧产业观察</a>',
  "/paper-loop": () => '<meta http-equiv="refresh" content="0; url=/paper-loop">',
  "/paper-external": () => '<meta http-equiv="refresh" content="0; url=https://example.com/paper">',
  // A Next.js page whose embedded posts hold arrays and brackets of their own.
  "/flight": () => `<html><body><script>self.__next_f.push([1,${JSON.stringify(`5:["$","div",null,{"children":[],"posts":${JSON.stringify([
    { slug: "first", title: "First [draft] post", categories: ["sglang", "news"] }, { slug: "second", title: "Second post", meta: { tags: [["a"]] } },
  ])},"after":["x"]}]\n`)}])</script></body></html>`,
  // A list API that gives calendar days as yyyymmdd.
  "/days.json": () => JSON.stringify({ data: { list: [{ seq: 695, ttl: "MCFlow", day: "20260922" }, { seq: 1, ttl: "Bad day", day: "20260230" }] } }),
  // Google Developers Blog: no date in the feed or in meta tags, only in JSON-LD.
  "/ld-post": () =>
    `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Blog"},` +
    `{"@type":"BlogPosting","headline":"Turn REST APIs into MCP tools","datePublished":"2026-09-24"}]}</script></head><body><p>Post</p></body></html>`,
  // A site that negotiates its language: the article at /en/post, its translation at /zh/post.
  "/en/blog": () => `<a class="row" href="/en/post"><p>Improved token efficiency</p><time>Sep 23, 2026</time></a>`,
  "/en/post": () => article("Improved token efficiency", "Agents now finish longer runs with fewer tokens. ".repeat(8)),
  "/missing-body": () => `<html><head><title>短剧合作新计划</title></head><div class="content"><h1>短剧合作新计划</h1><p>${"平台发布短剧合作新计划，为制作机构提供版权资源、创作支持和分账激励。".repeat(24)}</p></div></body></html>`,
  "/zh/post": () => article("提升 token 效率", "智能体现在能用更少的 token 完成更长的运行。".repeat(12)),
  "/en/feed.xml": () => `<rss version="2.0"><channel><item><title>Improved token efficiency</title><link>${site}/en/post</link><pubDate>Wed, 23 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>`,
  // liquid.ai/blog/lfm3 was 8.7 MB: the framework inlines the whole page payload again as script.
  "/large/post": () => article("LFM3", `Benchmarks for the new models. ${"Each row compares the same task. ".repeat(12)}</p><table><tr><th>Benchmark</th><th>LFM3</th></tr><tr><td><p>LiveClaw</p></td><td><p>45.60</p></td></tr></table><p>`)
    .replace("</body>", `<script>${"x".repeat(9 * 1024 * 1024)}</script></body>`),
  "/en/items.json": () => JSON.stringify([{ title: "Improved token efficiency", url: `${site}/en/post` }]),
};
function article(title: string, text: string) {
  return `<html><head><title>${title}</title><meta property="article:published_time" content="2026-09-23T12:00:00Z"></head><body><article><h1>${title}</h1><p>${text}</p></article></body></html>`;
}
const languages: Array<{ path: string; language: string | undefined }> = [];
const server = http.createServer((req, res) => {
  const path = req.url ?? "";
  if (path === "/negotiated-list") {
    const html = '<a href="/news/one">短剧产业政策发布</a>';
    const wantsJson = req.headers.accept?.includes("application/json");
    res.writeHead(200, { "content-type": wantsJson ? "application/json" : "text/html" });
    return res.end(wantsJson ? JSON.stringify(html) : html);
  }
  if (path === "/lmtw-home") {
    res.writeHead(200, { "content-type": "text/html", "set-cookie": "public_news_session=test-session; Path=/; HttpOnly" });
    return res.end('var tab_id = "1281"; var keyword_id = "29402"; var keyword_name = "0";');
  }
  if (path === "/mzw/content/ajaxGetNewsList") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      const fields = new URLSearchParams(body);
      const ok = req.method === "POST" && req.headers.cookie === "public_news_session=test-session" && req.headers["x-requested-with"] === "XMLHttpRequest" && fields.get("keyword_id") === "29402" && fields.get("tab_id") === "1281";
      res.writeHead(ok ? 200 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: 1, data: { html: '<div class="news-item"><a class="news-tit" href="/news/one">微短剧行业消息</a><time>2026-11-13</time></div>' } }));
    });
    return;
  }
  if (path === "/xinwanr-list" || path === "/bianews-list") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      const ok = req.method === "POST" && req.headers["content-type"] === "application/x-www-form-urlencoded" && body === `page_no=1&page_size=${path === "/bianews-list" ? 20 : 50}`;
      res.writeHead(ok ? 200 : 400, { "content-type": "text/html" });
      res.end('<li class="js_news_item" id="71122"><a class="title">短剧合作消息</a></li>');
    });
    return;
  }
  languages.push({ path, language: req.headers["accept-language"] });
  if (path === "/en/post" && /^zh/.test(req.headers["accept-language"] ?? "")) {
    res.writeHead(307, { location: "/zh/post" });
    return res.end();
  }
  const found = Object.hasOwn(pages, path);
  res.writeHead(found ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
  res.end(found ? pages[path]!() : "");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const site = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
config.allowPrivateNetworkFetch = true;
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

test("Jina card links become posts with their own titles", () => {
  const md = [
    "[Skip to main content](http://example.org/blog/#main)",
    "[![Image 1: hero](https://cdn.example.org/a.jpg) ##### 智元发布GE-Act 2.0 新闻资讯 | 2026-09-20](https://example.org/blog/220.html \"智元发布GE-Act 2.0\")",
    "[![Image 2](https://cdn.example.org/b.png) ##### 小米18 Pro Max 测评 尾巴视频](http://example.org/blog/784.html)",
    "[![Image 3](https://cdn.example.org/c.png)](https://example.org/blog/carousel.html)",
    "# [Introducing v6](http://example.org/blog/introducing-v6)",
    "[2026](http://example.org/blog/2026) [Algorithms & Theory](http://example.org/blog/label/algorithms) [Next page](http://example.org/blog/page/2)",
  ].join("\n\n");
  const out = fromMarkdown(md, "https://example.org", source({ url: "https://r.jina.ai/http://example.org/blog/", allowUrlPrefixes: ["https://example.org/blog/"] }));
  assert.deepEqual(out, [
    { url: "https://example.org/blog/220.html", title: "智元发布GE-Act 2.0" },
    { url: "https://example.org/blog/784.html", title: "小米18 Pro Max 测评 尾巴视频" },
    { url: "https://example.org/blog/introducing-v6", title: "Introducing v6" },
  ]);
});

test("anchors into the listing page itself are navigation, not posts", () => {
  // mimo.xiaomi.com links its own sections (#paper, #blog, #join): all one address once the fragment goes.
  const html = [
    '<a href="/#paper">Paper</a>', '<a href="/#blog">Blog</a>', '<a href="https://example.org/#join">Join Us</a>',
    '<a href="/">Home</a>', '<a href="/blog/mimo-v2-6-tool-call">Diagnosing Tool-Call Repetition</a>',
  ].join("");
  const out = fromHtml(html, "https://example.org/", source({ url: "https://example.org/" }));
  assert.deepEqual(out.map((c) => c.url), ["https://example.org/blog/mimo-v2-6-tool-call"]);
});

test("posts addressed by a query on the listing's path are posts, its pages and filters are not", () => {
  // WordPress plain permalinks: every post is /?p=N on the listing's own path.
  const links: [string, string][] = [
    ["/?p=123", "First research announcement"], ["/?p=456&lang=en", "Second research announcement"],
    ["/?utm_source=nav", "Home with tracking"], ["/?paged=2", "Older posts page"], ["/?cat=3", "Research category"], ["/#about", "About this site"],
  ];
  const html = links.map(([href, text]) => `<a href="${href}">${text}</a>`).join("");
  const md = links.map(([href, text]) => `[${text}](https://example.org${href})`).join("\n\n");
  const posts = ["https://example.org/?p=123", "https://example.org/?p=456&lang=en"];
  assert.deepEqual(fromHtml(html, "https://example.org/", source({ url: "https://example.org/" })).map((c) => c.url), posts);
  assert.deepEqual(fromMarkdown(md, "https://example.org/", source({ url: "https://r.jina.ai/https://example.org/" })).map((c) => c.url), posts);
  // The listing's own query in another order, with tracking and a page number, is still the listing.
  const filtered = source({ url: "https://example.org/news?lang=en&kind=ai" });
  const out = fromHtml('<a href="/news?kind=ai&lang=en&utm_medium=x&page=2">Next page of news</a><a href="/news?kind=ai&lang=en&id=7">A news post</a>', "https://example.org/", filtered);
  assert.deepEqual(out.map((c) => c.url), ["https://example.org/news?kind=ai&lang=en&id=7"]);
  // Hosts still compare as written: www is another host.
  assert.equal(fromHtml('<a href="https://www.example.org/">Home on www</a>', "https://example.org/", source({ url: "https://example.org/" })).length, 1);
});

test("promotions a feed rotates inside its posts are left out of the body", () => {
  // Microsoft Research's feed puts a different podcast or product promotion into each post on every load.
  const promo = (label: string, name: string) =>
    `<div class="border-bottom border-top mt-5 mb-5 msr-promo text-center alignwide" data-bi-aN="promo">` +
    `<p class="msr-promo__label text-uppercase"><span>${label}</span></p><div class="row"><div class="msr-promo__content">` +
    `<h2 class="h4">${name}</h2><p>Join Microsoft researchers.</p><a href="https://example.org/podcast">Listen now</a></div></div></div>`;
  const post = (p: string) => `<p>Skala is now available in the tools scientists use.</p>${p}<p>From community release to native integration.</p>`;
  const a = sanitizeBody(post(promo("PODCAST SERIES", "Ideas")), "https://example.org/post");
  const b = sanitizeBody(post(promo("", "Foundry Labs")), "https://example.org/post");
  assert.equal(a, b, "the same post whichever promotion it carried");
  assert.ok(!/PODCAST SERIES|Ideas|Foundry Labs|Listen now/.test(a));
  assert.ok(a.includes("native integration"), "the post's own text stays");
});

test("a listing that links other articles in its teasers takes only the links that begin a line", () => {
  // A news listing through Jina: each headline stands on its own line; its teaser links older stories inline.
  const md = [
    "### [Amodei critics target Trump with hit piece before White House dinner](https://example.org/2026/09/27/amodei)",
    "[![Image 3: Scoop](https://example.org/a.jpg)](https://example.org/2026/09/27/dinner)",
    "[Scoop: Anthropic's Dario Amodei to have White House dinner](https://example.org/2026/09/27/dinner)",
    "[How Ed Sheeran's U.S. tour went off the rails in 3 weeks](https://example.org/2026/09/25/sheeran)[![Image 12: Ed Sheeran](https://example.org/b.jpg)](https://example.org/2026/09/25/sheeran)",
    "Ed Sheeran's two Gillette Stadium shows were canceled Friday, capping a [chaotic three weeks](https://example.org/2026/09/15/sheeran-loop).",
    "**Why it matters:** AI is energy-hungry. [Political divides](https://example.org/2026/09/24/climate-politics) can slow progress.",
    "[Go deeper (3 min. read)](https://example.org/2026/09/25/sheeran)",
  ].join("\n\n");
  const config = { url: "https://r.jina.ai/https://example.org/technology", allowUrlPrefixes: ["https://example.org/2"], linksStartLine: true };
  assert.deepEqual(fromMarkdown(md, "https://example.org", source(config)).map((c) => c.title), [
    "Amodei critics target Trump with hit piece before White House dinner",
    "Scoop: Anthropic's Dario Amodei to have White House dinner",
    "How Ed Sheeran's U.S. tour went off the rails in 3 weeks",
  ]);
  assert.equal(fromMarkdown(md, "https://example.org", source({ ...config, linksStartLine: undefined })).length, 5, "without the option prose links count");
});

test("feed text that only teases the article is a summary: the page is fetched before judging", async () => {
  const read = await fetchRss({ id: "test-feed", config: { feedUrl: `${site}/teaser.xml` }, participation_mode: "editorial", cursor: null } as never, { force: true });
  const [teaser, whole] = read.candidates;
  assert.equal(teaser!.bodyStatus, "pending");
  assert.equal(teaser!.bodyText, null);
  assert.equal(teaser!.excerpt, "AMD announced today that it's acquiring World Labs.");
  assert.equal(whole!.bodyStatus, "ok");
  assert.ok(whole!.bodyText!.length > 1200);
  // Discussion sources only need what the feed says; one a module reads (sources.uses) is read whole.
  const signal = await fetchRss({ id: "test-feed", config: { feedUrl: `${site}/teaser.xml` }, participation_mode: "hot_signal", uses: [], cursor: null } as never, { force: true });
  assert.equal(signal.candidates[0]!.bodyStatus, "ok");
  const used = await fetchRss({ id: "test-feed", config: { feedUrl: `${site}/teaser.xml` }, participation_mode: "isolated", uses: ["free-tokens"], cursor: null } as never, { force: true });
  assert.equal(used.candidates[0]!.bodyStatus, "pending");
  assert.equal(used.candidates[0]!.bodyText, null);
});

test("a source that declares its feed summary the body keeps a short one, in RSS and Atom; a teaser is still a summary", async () => {
  const note = "How leaders build confidence with their team.";
  const read = async (path: string, summaryIsBody?: boolean) =>
    (await fetchRss({ id: "test-feed", config: { feedUrl: `${site}${path}`, ...(summaryIsBody ? { summaryIsBody } : {}) }, participation_mode: "editorial", cursor: null } as never, { force: true })).candidates;
  for (const path of ["/notes.xml", "/notes.atom"]) {
    const [plain] = await read(path);
    assert.deepEqual([plain!.bodyStatus, plain!.bodyText, plain!.excerpt], ["pending", null, note], `${path}: a short summary sends the item to its page`);
    const [declared] = await read(path, true);
    assert.deepEqual([declared!.bodyStatus, declared!.bodyText, declared!.excerpt], ["ok", note, note], `${path}: declared, it is the body`);
  }
  assert.equal((await read("/teaser.xml", true))[0]!.bodyStatus, "pending", "a teaser still asks for the page");
  const alternate = await fetchRss({ id: "test-feed", config: { feedUrl: `${site}/teaser.xml`, detail: { bodyUrlSuffix: ".patch" } }, participation_mode: "isolated", uses: ["free-tokens"], cursor: null } as never, { force: true });
  assert.ok(alternate.candidates.length);
  assert.ok(alternate.candidates.every((c) => c.bodyStatus === "pending"), "an explicit body alternate also replaces long commit summaries");
});

test("hidden page parts are dropped whole, and a news page's closing blocks are trimmed", () => {
  // microsoft.ai posts carry <template> blocks of base64 that became 330,000 characters of "body".
  const html = sanitizeBody(
    `<p>MAI-Transcribe-2 is our most capable transcription model.</p><template><div><p>${"QUFB".repeat(500)}</p></div></template>` +
      `<svg><text>chart label</text></svg><p>Energy <math><mi>E</mi><annotation encoding="application/x-tex">E=mc^2</annotation></math> matters.</p>`,
    "https://example.org/post",
  );
  assert.ok(!/QUFB|chart label|mc\^2/.test(html), html);
  assert.ok(html.includes("most capable transcription model") && html.includes("Energy E matters"));
  // A linked chart in a paragraph of its own survives, also when a translation is cleaned again.
  const chart = '<p><a href="https://example.org/chart.png"><img src="https://example.org/chart.png" alt="B200 prices"></a></p>';
  assert.ok(sanitizeBody(sanitizeBody(`<p>Prices doubled.</p>${chart}<p> </p>`)).includes('alt="B200 prices"'));
  assert.equal(sanitizeBody("<p>Text.</p><p> <br></p><p><a href=\"https://example.org/\"></a></p>"), "<p>Text.</p>");
  // A newsletter wraps each picture in a link to its full size, with the picture inside a frame and icon buttons beside it.
  const figure =
    '<div class="captioned-image-container"><figure><a class="image-link" href="https://cdn.example.org/full.jpeg">' +
    '<div class="image2-inset"><picture><source type="image/webp" srcset="https://cdn.example.org/w_424.webp 424w">' +
    '<img src="https://cdn.example.org/w_1456.jpeg" width="500" height="625" alt=""></picture>' +
    '<div class="image-link-expand"><div><button type="button"><svg viewBox="0 0 20 20"><path d="M2 7"></path></svg></button></div></div>' +
    '</div></a><figcaption>Agents claimed an improvement.</figcaption></figure></div>';
  const kept = sanitizeBody(`<p>Results below.</p>${figure}<p>Next section.</p>`, "https://example.org/p/post");
  // The frame is not a paragraph: Markdown cannot hold one inside a link.
  assert.equal(kept, '<p>Results below.</p><figure><a href="https://cdn.example.org/full.jpeg"><picture><img src="https://cdn.example.org/w_1456.jpeg" width="500" height="625" alt=""></picture></a>' +
    "<figcaption>Agents claimed an improvement.</figcaption></figure><p>Next section.</p>");
  assert.equal(sanitizeBody(kept, "https://example.org/p/post"), kept, "cleaning again keeps it");
  assert.ok(sanitizeBody('<a href="https://example.org/t"><div>Title</div><div>Teaser</div></a>').includes("<p>Title</p><p>Teaser</p>"), "text in a link keeps its lines");
  // Links with nothing to show inside still go, however deep: an empty frame, an icon, a tracking pixel.
  for (const empty of ['<a href="https://example.org/a"><div><span> </span></div></a>', '<a href="https://example.org/b"><div><svg><path d="M1 1"></path></svg></div></a>', '<a href="https://example.org/c"><div><img src="https://example.org/px.gif" width="1" height="1"></div></a>']) {
    assert.equal(sanitizeBody(`<p>Text.</p><p>${empty}</p>`), "<p>Text.</p>", empty);
  }
  // A news site ends every article the same way.
  const article = "<p>MongoDB’s shares dropped by more than 17%.</p><h2>Topics</h2><p>More on the deal.</p><p>Subscribe to our plan to get the API.</p>";
  assert.equal(trimTrailingChrome(`${article}<p>Topics</p><p>Subscribe for the industry’s biggest tech news</p><h2>Latest in AI</h2>`), article);
  assert.equal(trimTrailingChrome(article), article);
});

test("noise words match whatever their case", () => {
  // 笔记本 is noise, but the lower-case exemption agent keeps a post about an Agent product.
  const source = { config: { ingestNoiseFilter: { dropMarkers: ["笔记本", "iphone"], keepIfMatches: ["agent"] } } } as never;
  const c = (title: string, excerpt: string) => ({ url: "https://example.org/a", title, excerpt }) as never;
  assert.equal(noiseFiltered(c("Manus：正组建团队开发面向国内市场的产品", "与笔记本厂商合作的 Agent 产品"), source), false);
  assert.equal(noiseFiltered(c("新款笔记本开售", "首发价 4999 元"), source), true);
  assert.equal(noiseFiltered(c("iPhone 18 开售", ""), source), true);
});

test("a broad source can require an industry keyword before noise exemptions", () => {
  const s = source({ ingestNoiseFilter: { requireMarkers: ["短剧", "microdrama"], keepIfMatches: ["agent"] } });
  const c = (title: string, excerpt = "") => ({ url: "https://example.org/a", title, excerpt }) as never;
  assert.equal(noiseFiltered(c("平台发布MicroDrama合作计划"), s), false);
  assert.equal(noiseFiltered(c("平台新计划", "支持短剧创作者"), s), false);
  assert.equal(noiseFiltered(c("New Agent launch"), s), true);
  assert.equal(noiseFiltered({ url: "https://example.org/a", title: "New platform launch", bodyText: "Short-form MicroDrama programme" } as never, s), false);
  assert.equal(noiseFiltered(c("New Agent launch"), source({})), false);
  for (const requireMarkers of [[""], [123], "短剧", null]) {
    assert.deepEqual(unsupportedConfig("web_list", { ingestNoiseFilter: { requireMarkers } }), ["ingestNoiseFilter.requireMarkers"]);
  }
});

test("HTML cards can expose links in data attributes and Xinwanr IDs", () => {
  const markup = '<li data-link="/article/12"><h3>短剧合作消息</h3></li><li data-link="javascript:alert(1)"><h3>Invalid destination</h3></li>';
  const cards = fromHtml(markup, 'https://example.org/news', source({ itemSelector: 'li', linkSelector: 'li', linkAttribute: 'data-link', titleSelector: 'h3' }));
  assert.deepEqual(cards.map(c => c.url), ['https://example.org/article/12']);
  for (const linkAttribute of [{ 'data-link': '/a' }, '', null]) {
    assert.deepEqual(unsupportedConfig('web_list', { linkAttribute }), ['linkAttribute']);
  }
  const ids = fromHtml('<li id="71122"><a class="title">短剧版权合作</a></li><li id="not-an-id"><a class="title">Bad ID</a></li>', 'https://www.xinwanr.com/news_list_index', source({ adapter: 'xinwanr_news', itemSelector: 'li', titleSelector: '.title' }));
  assert.deepEqual(ids.map(c => [c.title, c.url]), [['短剧版权合作', 'https://www.xinwanr.com/news/details?id=71122']]);
});

test("Huanqiu's inert news cards expose only allowed article identities and real epoch dates", () => {
  const card = (id: string, host: string, type = 'article') => `<div class="item"><textarea class="item-aid">${id}</textarea><textarea class="item-addltype">${type}</textarea><textarea class="item-cnf-host">${host}</textarea><textarea class="item-title">微短剧行业新动态</textarea><textarea class="item-time">1794356126886</textarea></div>`;
  const html = card('A123','ent.huanqiu.com') + card('A123','ent.huanqiu.com') + card('B123','ent.huanqiu.com','gallery') + card('C123','ent.huanqiu.com.evil.test') + card('../D123','ent.huanqiu.com') + card('E123','tech.huanqiu.com');
  const out = fromHtml(html, 'https://ent.huanqiu.com/', source({ adapter: 'huanqiu_news', itemSelector: '.item', allowUrlPrefixes: ['https://ent.huanqiu.com/article/'] }));
  assert.equal(out.length, 1);
  assert.equal(out[0]?.url, 'https://ent.huanqiu.com/article/A123');
  assert.equal(out[0]?.publishedAt?.getTime(), 1794356126886);
  assert.deepEqual(unsupportedConfig('web_list', { adapter: 'huanqiu_news' }), []);
});

test("public embedded article bodies match the publisher and requested identity without executing scripts", () => {
  const prose = '微短剧产业发布合作计划，制作机构围绕精品创作与版权保护开展业务交流。'.repeat(30);
  const hq = `<html><head><title>微短剧合作计划</title></head><body><h1>微短剧合作计划</h1><textarea class="article-aid">A123</textarea><textarea class="article-content"><article><p>${prose}</p></article></textarea><textarea class="article-source-name"><a href="https://source.example/report">原始发布方</a></textarea></body></html>`;
  const read = (html: string, url: string) => readableDocument(contentDocument(html), url);
  const hqBody = read(hq, 'https://ent.huanqiu.com/article/A123');
  assert.ok(hqBody && hqBody.text.includes(prose));
  assert.ok(hqBody.html.includes('https://source.example/report'));
  assert.equal(read(hq, 'https://ent.huanqiu.com/article/B123'), null);
  const payload = { props: { pageProps: { contId: '806259', data: { contId: '806259', textInfo: { content: `<body><p>${prose}</p><script>globalThis.embeddedArticleExecuted = true;</script></body>` } } } } };
  const cnstock = `<html><head><title>微短剧合作计划</title></head><body><h1>微短剧合作计划</h1><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload).replaceAll('<', '\\u003c')}</script></body></html>`;
  const stockBody = read(cnstock, 'https://www.cnstock.com/commonDetail/806259');
  assert.ok(stockBody && stockBody.text.includes(prose));
  assert.ok(!stockBody.html.includes('<script'));
  assert.equal((globalThis as Record<string, unknown>).embeddedArticleExecuted, undefined);
  assert.equal(read(cnstock, 'https://www.cnstock.com/commonDetail/806260'), null);
  assert.equal(read(cnstock, 'https://example.org/commonDetail/806259'), null);
});

test("Tencent Cloud restores the matching article's public Markdown and original publication time", () => {
  const prose = '制作团队把角色造型、字幕、配音和镜头拆成独立的制作阶段，逐集验证结果。'.repeat(14);
  const payload = (articleId: number, contentType = 'markdown') => ({
    props: { query: { articleId: '2775390' }, pageProps: { fallback: {
      '#url:"/api/article/detail",params:#articleId:2775390,,': {
        publishTime: 1793724683,
        editTime: 1793940000,
        articleInfo: { articleId, contentType, content: `## 角色和分镜\n\n${prose}\n\n<script>globalThis.embeddedArticleExecuted = true;</script>` },
        articleData: { articleId: 2775390 },
      },
    } } },
  });
  const page = (data: ReturnType<typeof payload>, body = '') => `<html><head><title>短剧创作工程</title></head><body><h1>短剧创作工程</h1><div class="mod-content__markdown">${body}</div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script></body></html>`;
  const url = 'https://developer.cloud.tencent.com/article/2775390';
  const read = (html: string, at = url) => readableDocument(contentDocument(html), at);
  const body = read(page(payload(2775390)));
  assert.ok(body && body.text.includes(prose));
  assert.match(body.html, /<h2>角色和分镜<\/h2>/);
  assert.equal(body.publishedAt?.getTime(), 1793724683000);
  assert.ok(!body.html.includes('embeddedArticleExecuted'));
  assert.equal(read(page(payload(2775391))), null);
  assert.equal(read(page(payload(2775390, 'rich'))), null);
  assert.equal(read(page(payload(2775390)), 'https://example.org/article/2775390'), null);
  const rendered = read(page(payload(2775390), `<p>${'官方页面已经渲染完整文章。'.repeat(25)}</p>`));
  assert.ok(rendered && rendered.text.includes('官方页面已经渲染完整文章。'));
  assert.ok(!rendered.text.includes(prose));
});

test("a public JavaScript news array is parsed as JSON5 data without executing scripts", async () => {
  const cfg = { mode: 'html_window_var', windowVar: 'newsData', titlePaths: ['title'], urlTemplate: '{raw:url}' };
  const items = await fetchJsonList(source({ ...cfg, url: `${site}/json5-news` }));
  assert.deepEqual(items.map(c => c.url), ['https://example.org/a', 'https://example.org/b']);
  assert.equal((globalThis as Record<string, unknown>).newsDataExecuted, undefined);
  await assert.rejects(fetchJsonList(source({ ...cfg, url: `${site}/not-data-news` })));
  assert.equal((globalThis as Record<string, unknown>).newsDataExecuted, undefined);
});

test("Xinwanr listing posts the public form and emits article links", async () => {
  const items = await fetchWebList(source({ url: `${site}/xinwanr-list`, adapter: "xinwanr_news", itemSelector: "li.js_news_item", titleSelector: "a.title" }));
  assert.deepEqual(items.map(c => [c.title,c.url]), [["短剧合作消息", `${site}/news/details?id=71122`]]);
});

test("Bianews uses its public POST list and numeric card IDs", async () => {
  const items = await fetchWebList(source({ url: `${site}/bianews-list`, adapter: "bianews_news", itemSelector: "li.js_news_item", titleSelector: "a.title" }));
  assert.equal(items[0]?.url, `${site}/news/details?id=71122`);
});

test("HTML listings negotiate an HTML document rather than a JSON string", async () => {
  const items = await fetchWebList(source({ url: `${site}/negotiated-list` }));
  assert.equal(items[0]?.url, `${site}/news/one`);
});

test("an article with an omitted opening body tag still has a readable body", async () => {
  const body = await extractFromUrl(`${site}/missing-body`, "missing-body", {}, { paidFallback: false });
  assert.ok(body && body.text.includes("平台发布短剧合作新计划") && body.text.length >= 500);
});

test("an electronic newspaper's permanent meta refresh resolves same-origin issue links", async () => {
  const items = await fetchWebList(source({ url: `${site}/paperindex.htm` }));
  assert.equal(items[0]?.url, `${site}/html/2026-11/13/content_123.htm`);
  for (const path of ["/paper-loop", "/paper-external"]) {
    await assert.rejects(fetchWebList(source({ url: site + path })), /same-origin limit/);
  }
});

test("an electronic newspaper's static issue redirect opens its linked article index", async () => {
  const items = await fetchWebList(source({ url: `${site}/epaper/` }));
  assert.deepEqual(items.map(({ title, url }) => [title, url]), [
    ["微短剧行业观察", `${site}/epaper/2026/11/18/article_detail_1_20261118A031.html`],
  ]);
});

test("LMTW reads the current public listing through its fresh anonymous session", async () => {
  const items = await fetchWebList(source({ url: `${site}/lmtw-home`, adapter: "lmtw_news", itemSelector: ".news-item", linkSelector: "a.news-tit", publishedAtSelector: "time" }));
  assert.equal(items.length, 1);
  assert.equal(items[0]?.url, `${site}/news/one`);
  assert.ok(items[0]?.publishedAt);
});

test("a detail date unit is explicit: epoch seconds and day-month-year preserve publication dates", async () => {
  const date = async (publishedAtRegex: string, publishedAtUnit: string) => (await fetchDetail(`${site}/typed-dates`, source({ detail: { publishedAtRegex, publishedAtUnit, publishedAtAuthoritative: true } }), { date: true, title: false, summary: false })).publishedAt;
  assert.equal((await date('data-article-publish-time="(\\d+)"', 'epoch_s'))?.getTime(), 1793009118000);
  assert.equal((await date('<time>([^<]+)</time>', 'dmy'))?.toISOString(), '2026-11-03T16:00:00.000Z');
  assert.equal(await date('<i>([^<]+)</i>', 'dmy'), null);
  assert.equal((await date('<b>([^<]+)</b>', 'dmy'))?.toISOString(), '2026-11-05T16:00:00.000Z');
  assert.deepEqual(unsupportedConfig('web_list', { detail: { publishedAtUnit: 'guess' } }), ['detail.publishedAtUnit']);
  assert.deepEqual(unsupportedConfig('web_list', { detail: { publishedAtUnit: 'epoch_s' } }), ['detail.publishedAtUnit']);
});

test("a publication date node can put its year and month/day on separate lines", async () => {
  const date = async (publishedAtSelector: string) => (await fetchDetail(`${site}/split-date`, source({ detail: { publishedAtSelector, publishedAtAuthoritative: true } }), { date: true, title: false, summary: false })).publishedAt;
  assert.equal((await date('.ldate'))?.toISOString(), '2026-05-19T00:05:00.000Z');
  assert.equal(await date('.related'), null);
});

test("a time without a zone is read in the source's offset, in JSON lists and in detail page metadata", async () => {
  const list = async (extra: Record<string, unknown> = {}) => (await fetchJsonList({ id: "test-json", config: { url: `${site}/zoneless.json`, itemsPath: "result", titlePaths: ["title"], urlTemplate: "https://example.org/p/{id}", publishedAtPath: "publishDate", ...extra } } as never))
    .map((c) => c.publishedAt?.toISOString());
  assert.deepEqual(await list(), ["2026-09-30T09:43:58.000Z", "2026-09-30T17:43:58.000Z", "2026-09-30T22:43:58.000Z"], "+08:00 by default, as list pages; a time with its zone keeps it");
  assert.deepEqual(await list({ publishedAtUtcOffset: "+00:00" }), ["2026-09-30T17:43:58.000Z", "2026-09-30T17:43:58.000Z", "2026-09-30T22:43:58.000Z"]);
  const detail = async (offset?: string) => (await fetchDetail(`${site}/zoneless-post`, { id: "test-feed", config: { detail: { maxFetches: 20, publishedAtUtcOffset: offset } } } as never, { date: true, title: false, summary: false, body: false })).publishedAt?.toISOString();
  assert.deepEqual([await detail(), await detail("+00:00")], ["2026-09-30T09:43:58.000Z", "2026-09-30T17:43:58.000Z"]);
});

test("posts embedded in a flight payload keep their own arrays and brackets inside strings", async () => {
  const posts = await fetchJsonList({ id: "test-json", config: { url: `${site}/flight`, mode: "html_json_key", jsonKey: "posts", titlePaths: ["title"], urlTemplate: "https://example.org/blog/{slug}" } } as never);
  assert.deepEqual(posts.map((c) => [c.title, c.url]), [["First [draft] post", "https://example.org/blog/first"], ["Second post", "https://example.org/blog/second"]]);
});

test("dates in yyyymmdd and in JSON-LD are read", async () => {
  const days = await fetchJsonList({ id: "test-json", config: { url: `${site}/days.json`, itemsPath: "data.list", titlePaths: ["ttl"], urlTemplate: "https://example.org/blog/view?seq={seq}", publishedAtPath: "day", publishedAtUnit: "yyyymmdd" } } as never);
  assert.deepEqual(days.map((c) => c.publishedAt?.toISOString() ?? null), ["2026-09-21T16:00:00.000Z", null], "calendar days use the source offset; February 30 is no date");
  const got = await fetchDetail(`${site}/ld-post`, { id: "test-feed", config: { detail: { maxFetches: 20 } } } as never, { date: true, title: false, summary: false, body: false });
  assert.equal(got.publishedAt?.toISOString(), "2026-09-23T16:00:00.000Z");
  assert.equal(got.publicationTime, "2026-09-24");
});

test("a source's language reaches its listing, detail page and article body, which stay in that language", async () => {
  const EN = "en-US,en;q=0.9";
  const sent = (path: string) => languages.filter((hit) => hit.path === path).at(-1)?.language;
  const listing = { url: `${site}/en/blog`, parseMode: "html", itemSelector: "a.row", titleSelector: "p", publishedAtSelector: "time", publishedAtUtcOffset: "+00:00" };
  const web = source({ ...listing, acceptLanguage: EN, detail: { publishedAtSelector: "meta[property='article:published_time']" } });
  const [item] = await fetchWebList(web);
  assert.equal(sent("/en/blog"), EN);
  assert.equal(item?.url, `${site}/en/post`, "the article keeps its own address");
  const detail = await fetchDetail(item!.url, web, { date: true, title: false, summary: false, body: true });
  assert.match(detail.body?.text ?? "", /^Agents now finish/);
  const body = await extractFromUrl(item!.url, "article:fixture", pageRules({ acceptLanguage: EN }));
  assert.match(body?.text ?? "", /^Agents now finish/);
  assert.equal(languages.some((hit) => hit.path === "/zh/post"), false, "no read was sent to the translation");
  await fetchRss(source({ feedUrl: `${site}/en/feed.xml`, acceptLanguage: EN }));
  assert.equal(sent("/en/feed.xml"), EN);
  await fetchJsonList(source({ url: `${site}/en/items.json`, titlePaths: ["title"], urlTemplate: "{raw:url}", acceptLanguage: EN }));
  assert.equal(sent("/en/items.json"), EN);

  // Without one, the default Chinese preference stays.
  await fetchWebList(source(listing));
  assert.match(sent("/en/blog") ?? "", /^zh-CN/);
  assert.match((await extractFromUrl(item!.url, "article:fixture", pageRules({})))?.text ?? "", /^智能体/);
});

test("a page of several megabytes is read directly, keeping its tables", async () => {
  const body = await extractFromUrl(`${site}/large/post`, "article:fixture", {}, { paidFallback: false });
  assert.equal(body?.via, "readability");
  assert.match(body?.html ?? "", /<table>.*LiveClaw.*45\.60.*<\/table>/s);
});

test("a source's language is an Accept-Language value, refused by kinds that read no pages", () => {
  for (const kind of ["rss", "web_list", "json_list"] as const) {
    assert.deepEqual(unsupportedConfig(kind, { acceptLanguage: "en-US,en;q=0.9" }), [], kind);
    for (const acceptLanguage of ["", " ", 1, null, ["en"], "en\r\nx-injected: 1"]) {
      assert.deepEqual(unsupportedConfig(kind, { acceptLanguage }), ["acceptLanguage"], `${kind} ${JSON.stringify(acceptLanguage)}`);
    }
  }
  for (const kind of ["x_search", "mp_account", "external"] as const) assert.deepEqual(unsupportedConfig(kind, { acceptLanguage: "en" }), ["acceptLanguage"], kind);
});
