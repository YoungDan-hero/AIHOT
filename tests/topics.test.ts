// Topic pages: which articles a topic takes, and their counts.
// Written before the code, from the ways it can go wrong:
// - a company topic takes an article about another company that only mentions it (several subjects,
//   its name nowhere in the title), or drops one about it whose title names it in English, in another
//   case, next to Chinese text, or only by a product (it is the article's only subject);
// - a Latin name matches inside another word ("Wattpadder" is not Wattpad); a headline naming a company
//   that is not a subject of the article gets in;
// - a production-direction topic stops taking its tags;
// - withdrawn or not yet released articles appear in a list or a count;
// - an article or story page names a topic its reports do not belong to;
// - an article page cannot tell which of its tags are a topic's own, so they link to filtered lists;
// - a topic without content has no page, or an unknown slug or a page past the end has one.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { TOPICS, loadTopicPage, listTopicSummaries, topicsOfStory } from "@aihot/backend/publication/topics";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const OFFICIAL = `test-topics-official-${T}`;
const MEDIA = `test-topics-media-${T}`;
const app = await buildApp();

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, first_party, next_fetch_at) VALUES
    (${OFFICIAL}, 'Official', 'rss', 'T1', 'editorial', true, '2100-01-01'),
    (${MEDIA}, 'Media', 'rss', 'T2', 'editorial', false, '2100-01-01')`;
});
after(async () => {
  await app.close();
  await stopBoss();
  await closeDb();
});

let n = 0;
interface Report {
  source?: string;
  at: Date;
  title: string;
  originalTitle?: string;
  subjects?: string[];
  tags?: string[];
  score?: number;
  selected?: boolean;
  fact?: number;
  category?: string;
}

/** A published report; `fact` links it to a fact before publishing, as grouping would. */
async function report(r: Report): Promise<string> {
  n += 1;
  const { articleId } = await upsertMaterial({
    sourceId: r.source ?? MEDIA, url: `https://example.com/topics-${T}-${n}`, title: r.originalTitle ?? r.title, bodyText: "body", bodyHtml: "<p>body</p>", bodyStatus: "ok", via: "fetch", publishedAt: r.at,
  });
  await sql`UPDATE articles SET discovered_at = ${r.at}, timeline_at = ${r.at}, grouped_at = now() WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, subjects, tags)
            VALUES (${articleId}, 1, 'rule', 'pass', ${r.category ?? "domestic"}, ${r.title}, ${`摘要 ${n}`}, ${r.score ?? 80}, ${r.selected ?? true}, ${r.subjects ?? []}, ${["剧目动态", "真人短剧", ...(r.tags ?? [])]})`;
  if (r.fact) await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${r.fact}, ${articleId}, 'report')`;
  await publishArticle(articleId, { releasedAt: new Date(r.at.getTime() + 60_000) });
  return articleId;
}

async function story(title: string): Promise<{ id: number; publicId: string }> {
  const publicId = randomUUID();
  const [s] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title, first_report_at, latest_at) VALUES (${publicId}, ${title}, now(), now()) RETURNING id`;
  return { id: s!.id, publicId };
}

async function fact(storyId: number | null, title: string): Promise<number> {
  const [f] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, story_id, title) VALUES (${`f-${T}-${randomUUID()}`}, ${storyId}, ${title}) RETURNING id`;
  return f!.id;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);
const page = async (slug: string, p = 1) => {
  const data = await loadTopicPage(slug, p, new Date());
  assert.ok(data, `${slug} page ${p}`);
  return data;
};
/** Every article of a topic, over all its pages. */
async function members(slug: string): Promise<string[]> {
  const first = await page(slug);
  const out = ids(first.items);
  for (let p = 2; p <= first.pageCount; p++) out.push(...ids((await page(slug, p)).items));
  return out;
}

test("a company topic takes the articles about it, not the ones that only mention it", async () => {
  const about = await report({ at: hoursAgo(30), title: `ReelShort 推出新剧场 ${T}`, subjects: ["crazy-maple"] });
  const product = await report({ at: hoursAgo(31), title: `独家短剧新版上线 ${T}`, subjects: ["crazy-maple"] });
  const english = await report({ at: hoursAgo(32), title: `新剧集发布 ${T}`, originalTitle: `Crazy Maple Studio launches a series ${T}`, subjects: ["crazy-maple", "dramabox"] });
  const subpoena = await report({ at: hoursAgo(33), title: `监管机构向 DramaBox 发出问询 ${T}`, subjects: ["dramabox", "crazy-maple", "netshort"] });
  const lowerCase = await report({ at: hoursAgo(34), title: `dramabox 公布新的发行安排 ${T}`, subjects: ["dramabox", "crazy-maple"] });
  const pact = await report({ at: hoursAgo(35), title: `二十余家短剧公司签署合作协议 ${T}`, subjects: ["dramabox", "crazy-maple", "netshort"] });
  const compound = await report({ at: hoursAgo(36), title: `Wattpadder 工具发布，DramaBox 参与 ${T}`, subjects: ["wattpad", "dramabox"] });
  const adjacent = await report({ at: hoursAgo(37), title: `发布Wattpad的改编计划 ${T}`, subjects: ["wattpad", "dramabox"] });
  const headline = await report({ at: hoursAgo(38), title: `ReelShort 被一篇盘点提到 ${T}`, subjects: ["netshort"] });
  const production = await report({ at: hoursAgo(39), title: `短剧编剧方法发布 ${T}`, tags: ["制作/编剧"] });

  const reelshort = await members("reelshort");
  for (const id of [about, product, english]) assert.ok(reelshort.includes(id), "about ReelShort");
  for (const id of [subpoena, lowerCase, pact, headline]) assert.ok(!reelshort.includes(id), "only mentions ReelShort");
  const dramabox = await members("dramabox");
  for (const id of [subpoena, lowerCase, compound]) assert.ok(dramabox.includes(id), "about DramaBox");
  for (const id of [english, pact]) assert.ok(!dramabox.includes(id), "only mentions DramaBox");
  const wattpad = await members("wattpad");
  assert.ok(wattpad.includes(adjacent), "Wattpad next to Chinese text");
  assert.ok(!wattpad.includes(compound), "Wattpadder is not Wattpad");
  assert.ok((await members("production")).includes(production), "a production direction takes its tag");

  // The article page names the topics it belongs to.
  const topicsOf = async (id: string) => {
    const res = await app.inject({ method: "GET", url: `/api/site/items/${id}` });
    return (JSON.parse(res.body) as { topics: Array<{ slug: string }> }).topics.map((t) => t.slug);
  };
  assert.deepEqual(await topicsOf(about), ["reelshort", "live-action"]);
  assert.deepEqual(await topicsOf(subpoena), ["dramabox", "live-action"]);
  assert.deepEqual(await topicsOf(pact), ["live-action"]);
  assert.deepEqual(await topicsOf(production), ["production", "live-action"]);
});

test("an article page says which of its tags are a topic's own", async () => {
  // A direction's or a form's tags, and the tag cards show for a company (its subject tag is never shown).
  const id = await report({ at: hoursAgo(3), title: `ReelShort 发布短剧编剧与发行方法 ${T}`, subjects: ["crazy-maple", "dramabox"], tags: ["制作/编剧", "发行/出海", "ReelShort", "DramaBox", "剧场"] });
  const res = await app.inject({ method: "GET", url: `/api/site/items/${id}` });
  const body = JSON.parse(res.body) as { tags: string[]; tagTopics: Record<string, string>; topics: Array<{ slug: string }> };
  assert.deepEqual(body.tags, ["剧目动态", "真人短剧", "制作/编剧", "发行/出海", "ReelShort", "DramaBox", "剧场"]);
  assert.deepEqual(body.tagTopics, { "真人短剧": "live-action", "制作/编剧": "production", "发行/出海": "distribution", ReelShort: "reelshort", DramaBox: "dramabox" });
  // The company its title does not name is a topic of the tag, not of the article.
  assert.deepEqual(body.topics.map((t) => t.slug), ["reelshort", "production", "distribution", "live-action"]);
});

test("a company topic's full name and aliases find subject-tagged reports", async () => {
  const id = await report({at: hoursAgo(2), title: `新版海外剧场上线 ${T}`, subjects: ['crazy-maple'], selected: false});
  for (const query of ['ReelShort / Crazy Maple Studio', '枫叶互动']) {
    const res = await app.inject({method: 'GET', url: `/api/site/pool?q=${encodeURIComponent(query)}`});
    assert.equal(res.statusCode, 200);
    assert.ok(ids(JSON.parse(res.body).items).includes(id), 'full company names must still find subject-tagged reports');
  }
});

test("a story page names the topics of its reports", async () => {
  const launch = await story(`短剧编剧方法第二版发布 ${T}`);
  await report({ source: OFFICIAL, at: hoursAgo(26), title: `短剧编剧方法第二版发布 ${T}`, tags: ["制作/编剧"], fact: await fact(launch.id, "发布第二版") });
  assert.deepEqual(await topicsOfStory(launch.id), [{ slug: "production", name: "制作与编剧" }, { slug: "live-action", name: "真人短剧" }]);
});

test("withdrawn articles stay out of lists and counts", async () => {
  const kept = await report({ at: hoursAgo(5), title: `红果短剧发布新剧 ${T}`, subjects: ["hongguo"] });
  const withdrawn = await report({ at: hoursAgo(4), title: `红果短剧撤回的消息 ${T}`, subjects: ["hongguo"] });
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${withdrawn}`;

  const data = await page("hongguo");
  assert.deepEqual(ids(data.items), [kept]);
  assert.equal(data.topic.total, 1);
  const summary = (await listTopicSummaries()).topics.find((t) => t.slug === "hongguo")!;
  assert.equal(summary.latest?.title, `红果短剧发布新剧 ${T}`, "the index shows the newest public article");
});

test("every topic has a page; unknown topics and pages past the end have none", async () => {
  const empty = await page("copyright-policy");
  assert.equal(empty.topic.indexable, false, "a topic without content is not indexed");
  assert.deepEqual(empty.items, []);
  assert.equal(await loadTopicPage("not-a-topic", 1, new Date()), null);
  assert.equal(await loadTopicPage("copyright-policy", 2, new Date()), null);
  const index = await app.inject({ method: "GET", url: "/api/site/topics" });
  const body = JSON.parse(index.body) as { groups: Array<{ key: string }>; topics: Array<{ slug: string }> };
  assert.deepEqual(body.groups.map((g) => g.key), ["company", "field", "genre"]);
  assert.deepEqual(body.topics.map((t) => t.slug).sort(), TOPICS.map((t) => t.slug).sort(), "the index lists every topic");
});
