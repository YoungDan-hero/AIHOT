// Article, event and report text can link to pages offered by installed modules.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadItemDetail } from "@aihot/backend/publication/detail";
import { loadStoryDetail } from "@aihot/backend/publication/stories";
import { loadReport } from "@aihot/backend/publication/reports";
import { stopBoss } from "@aihot/backend/jobs/queue";

const T = tag();
const source = `mentions-${T}`;
const at = new Date("2026-09-30T00:00:00Z");
const dramas = [{ name: "dramas", mentions: async () => [{ href: "/dramas/spring-letter", names: ["春日来信"] }] }];
let sequence = 0;

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
    VALUES (${source}, 'Mention source', 'rss', 'T1', 'editorial', '2100-01-01')`;
});
after(async () => { installModules([]); await stopBoss(); await closeDb(); });

async function article(title: string, summary: string) {
  const { articleId } = await upsertMaterial({ sourceId: source, url: `https://example.com/${T}/${++sequence}`, title,
    bodyText: "Fixture body", bodyHtml: "<p>Fixture body</p>", bodyStatus: "ok", via: "fetch", publishedAt: at });
  await sql`UPDATE articles SET grouping_status = 'complete' WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
    VALUES (${articleId}, 1, 'rule', 'pass', 'industry', ${title}, ${summary}, 90, true)`;
  await publishArticle(articleId, { releasedAt: at });
  return articleId;
}

const hrefs = (mentions: Array<{ href: string | null }>) => mentions.map((m) => m.href);

test("an article page is sent the installed module pages its summary names", async () => {
  const id = await article("春日来信 发布", "ReelShort 发布 春日来信，接入了已有的应用。");
  installModules([]);
  const bare = await loadItemDetail(id);
  assert.equal(bare.kind, "found");
  if (bare.kind !== "found") return;
  assert.deepEqual(hrefs(bare.item.mentions), [], "a site without modules offers no mention links");

  installModules(dramas);
  const full = await loadItemDetail(id);
  if (full.kind !== "found") return assert.fail("article missing");
  assert.deepEqual(full.item.mentions, [
    { href: "/dramas/spring-letter", names: ["春日来信"] },
  ]);
});

test("an event page is sent the pages its overview names", async () => {
  installModules(dramas);
  const id = await article("DramaBox发布 春日来信 对手", "DramaBox发布 春日来信 的对手。");
  const [s] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title, first_report_at, latest_at) VALUES (${randomUUID()}, 'DramaBox发布新短剧', ${at}, ${at}) RETURNING id`;
  const [f] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, story_id, title, subject, action, object) VALUES (${`f-${randomUUID()}`}, ${s!.id}, 'DramaBox发布新短剧', 'DramaBox', '发布', '新短剧') RETURNING id`;
  await sql`INSERT INTO fact_articles (fact_id, article_id, role, evidence) VALUES (${f!.id}, ${id}, 'report', 'fixture')`;
  await sql`UPDATE publications SET story_id = ${s!.id}, fact_id = ${f!.id} WHERE article_id = ${id}`;
  const story = (await loadStoryDetail(Number(s!.id), new Date(+at + 3600_000)))!;
  assert.equal(story.excerpt?.text, "DramaBox发布 春日来信 的对手。");
  assert.deepEqual(hrefs(story.mentions), ["/dramas/spring-letter"]);
});

test("a report is sent the pages its lead and summaries name", async () => {
  installModules(dramas);
  const id = await article("春日来信 发布", "春日来信 上线。");
  const key = "2096-02-01";
  await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at, origin)
    VALUES ('daily', ${key}, ${at}, ${at}, ${sql.json({
      lead: { title: "红果短剧发布扶持计划", leadParagraph: "红果短剧发布扶持计划。" },
      sections: [{ label: "国内动态", items: [{ itemId: id, title: "春日来信 发布", summary: "春日来信 上线。", sourceUrl: "https://example.com", sourceName: "Mention source" }] }],
    } as never)}, ${at}, 'manual')`;
  const report = (await loadReport("daily", key))!;
  assert.deepEqual(hrefs(report.mentions), ["/dramas/spring-letter"]);
});
