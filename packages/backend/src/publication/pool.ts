// Public pool (/all) with numeric pages, and search in its two orderings.
import type { PoolResponse, TimelineFilters } from "@aihot/contracts/site";
import { beijingDate, beijingMidnight } from "@aihot/contracts/time";
import { one, sql, withCustomPlans, type Db } from "../db.ts";
import { entityIdentity } from "../editorial/vocabulary.ts";
import { sharedSearch } from "../lib/cache.ts";
import {
  categoryCondition, channelCondition, ITEM_COLUMNS, ITEM_FROM, seatHolders, tagCondition, toFeedItemSummary,
  type ItemRow,
} from "./items.ts";
import { browsedCondition, listedCondition, ownFactEvidenceCondition } from "./scope.ts";

export const POOL_PAGE_SIZE = 40;
export const POOL_MAX_PAGES = 50;

export class SearchBusyError extends Error {
  readonly retryAfter: number;
  constructor(retryAfter: number) {
    super("search capacity exhausted");
    this.retryAfter = retryAfter;
  }
}

// Search capacity guard: bounded concurrency with a short queue. Overflow answers 503 + Retry-After
// instead of letting machine traffic drag list browsing down.
const MAX_CONCURRENT_SEARCHES = 4;
const MAX_QUEUED_SEARCHES = 8;
let running = 0;
const waiters: Array<() => void> = [];

export async function withSearchCapacity<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT_SEARCHES) {
    if (waiters.length >= MAX_QUEUED_SEARCHES) throw new SearchBusyError(5);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = waiters.indexOf(go);
        if (i >= 0) waiters.splice(i, 1);
        reject(new SearchBusyError(5));
      }, 3000);
      const go = () => {
        clearTimeout(timer);
        resolve();
      };
      waiters.push(go);
    });
  }
  running += 1;
  try {
    return await withCustomPlans(fn);
  } finally {
    running -= 1;
    waiters.shift()?.();
  }
}

/** Search terms: whitespace separated, lower-cased, LIKE metacharacters escaped. */
export function searchTerms(q: string): string[] {
  return q
    .toLowerCase()
    // "多模态RAG" means 多模态 and rag: split where Han meets a Latin word. Digits alone stay attached,
    // so "10月" is still one term rather than 10 and 月.
    .replace(/(\p{Script=Han})(?=[a-z])/gu, "$1 ")
    .replace(/([a-z][a-z0-9]*)(?=\p{Script=Han})/gu, "$1 ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((t) => t.replace(/[\\%_]/g, (m) => `\\${m}`));
}

/** Default search: subject, title or summary match (search_text), newest first. */
export function directMatchCondition(terms: string[]) {
  if (terms.length === 0) return sql``;
  return terms.reduce((acc, t) => sql`${acc} AND p.search_text LIKE ${"%" + t + "%"}`, sql``);
}

/**
 * The public APIs' q (v1 and MCP): every term matches the subject, title or summary, or the start of a
 * body whose full text may be shown, as the API documents it ("title / Chinese title / Chinese summary
 * / body"). Results stay in time order.
 */
/** A plain Latin or digit term must start a word in the body: "rag" is not inside "storage". */
function bodyMatch(t: string) {
  const like = sql`ps.body LIKE ${"%" + t + "%"}`;
  return /^[a-z0-9]+$/.test(t) ? sql`${like} AND ps.body ~ ${"(^|[^a-z0-9])" + t}` : like;
}

export function publicMatchCondition(terms: string[]) {
  if (terms.length === 0) return sql``;
  // Keep the body lookup correlated to the time-ordered candidates. Without OFFSET 0, PostgreSQL
  // may hash every matching body in pool_search before serving even the first 40 recent items.
  return terms.reduce(
    (acc, t) => sql`${acc} AND (p.search_text LIKE ${"%" + t + "%"} OR EXISTS (
      SELECT 1 FROM pool_search ps WHERE ps.article_id = p.article_id AND ${bodyMatch(t)} OFFSET 0))`,
    sql``,
  );
}

export interface PoolQuery extends TimelineFilters {
  q?: string | null;
  tab?: "time" | "relevance";
  page?: number;
  now?: Date;
}

// Identical searches share their read before taking search capacity.
const searchPool = sharedSearch(
  (q: PoolQuery) => JSON.stringify([q.channel, q.category, q.tag, q.q, q.tab, q.page]),
  queryPool, (q) => !!q.q?.trim(),
);

export function loadPool(query: PoolQuery): Promise<PoolResponse> {
  return searchPool(query, query.now);
}

async function queryPool(query: PoolQuery, now: Date): Promise<PoolResponse> {
  const page = Math.min(Math.max(query.page ?? 1, 1), POOL_MAX_PAGES);
  const q = query.q?.trim() || null;
  const tab = q && query.tab === "relevance" ? "relevance" : "time";
  const terms = q ? searchTerms(q) : [];
  // A whole company name or alias also finds reports with that entity's subject tag.
  const entity = entityIdentity(q);
  const entityTag = entity ? `entity:${entity}` : null;
  const filters = sql`${channelCondition(query.channel)} ${categoryCondition(query.category)} ${tagCondition(query.tag)}`;
  const offset = (page - 1) * POOL_PAGE_SIZE;
  const cap = POOL_MAX_PAGES * POOL_PAGE_SIZE;
  const todayStart = beijingMidnight(beijingDate(now));
  type PoolMeta = { today_count: number; updated_at: Date | null };

  // Searches go through pool_search (eligible items only): trigram indexes for longer terms, a small
  // table to scan for one- and two-character ones.
  const matchOrSubject = (text: ReturnType<typeof directMatchCondition>) => (entityTag ? sql`AND (p.tags @> ${[entityTag]}::text[] OR (TRUE ${text}))` : text);
  const like = (col: ReturnType<typeof sql>, t: string) => sql`${col} LIKE ${"%" + t + "%"}`;
  const run = async (db: Db) => {
    if (!q) {
      // The first browsable report's timeline date holds the group's place, including archived backfills.
      type GroupedRow = Omit<ItemRow, "id"> & PoolMeta & {
        id: string | null;
        total: number;
        group_fact_id: string | null;
        report_count: number;
        source_count: number;
      };
      const result = await db<GroupedRow[]>`
        WITH candidates AS (
          SELECT p.article_id, p.source_id, p.discovered_at, p.timeline_at,
            CASE WHEN p.fact_id IS NOT NULL AND ${ownFactEvidenceCondition()} THEN p.fact_id END AS fact_id
          FROM publications p WHERE ${browsedCondition(now)} ${filters}
        ), groups AS MATERIALIZED (
          SELECT fact_id, (array_agg(article_id ORDER BY discovered_at, article_id))[1] AS article_id,
            (array_agg(timeline_at ORDER BY discovered_at, article_id))[1] AS anchor_at,
            count(*)::int AS report_count, count(DISTINCT source_id)::int AS source_count
          FROM candidates GROUP BY fact_id, CASE WHEN fact_id IS NULL THEN article_id END
        ), page AS (
          SELECT * FROM groups ORDER BY anchor_at DESC, article_id DESC LIMIT ${POOL_PAGE_SIZE} OFFSET ${offset}
        ), meta AS (
          SELECT least(count(*), ${cap})::int AS total, count(*) FILTER (WHERE anchor_at >= ${todayStart})::int AS today_count,
            (SELECT max(updated_at) FROM publications WHERE eligible) AS updated_at
          FROM groups
        )
        SELECT hydrated.*, meta.* FROM meta LEFT JOIN LATERAL (
          SELECT ${ITEM_COLUMNS}, f.public_id::text AS group_fact_id, page.report_count, page.source_count
          ${ITEM_FROM} JOIN page ON page.article_id = p.article_id LEFT JOIN facts f ON f.id = page.fact_id
        ) hydrated ON true
        ORDER BY hydrated.timeline_at DESC, hydrated.id DESC`;
      const rows = result.filter((row): row is GroupedRow & ItemRow => row.id !== null);
      const groups: NonNullable<PoolResponse["groups"]> = Object.fromEntries(rows.flatMap((row) =>
        row.group_fact_id && row.report_count > 1 ? [[row.id, {
          factId: row.group_fact_id, anchorAt: row.timeline_at.toISOString(),
          reportCount: row.report_count, additionalSourceCount: row.source_count - 1,
        }]] : []));
      const { total, today_count, updated_at } = one(result);
      return { rows, total, groups, browseMeta: { today_count, updated_at } };
    }
    if (tab === "relevance") {
      // Rank narrow rows first: no article bodies or translations enter the sort/count. The public
      // total stops at 2,000, even though ranking must consider every matching item.
      // For an unfiltered trigram search, match each indexed field separately. OR across fields
      // can make PostgreSQL scan every toasted body instead. Keep other searches inline so short
      // terms, additional terms and selective publication filters retain their existing plans.
      const splitFields = terms.length === 1 && /[\p{L}\p{N}]{3}/u.test(terms[0]!)
        && (!query.channel || query.channel === "all") && !query.category && !query.tag;
      const partScore = terms.reduce(
        (acc, t) => sql`${acc} + (CASE WHEN ${like(sql`ps.direct`, t)} THEN 3 ELSE 0 END) + (CASE WHEN ${like(sql`ps.body`, t)} THEN 1 ELSE 0 END)`,
        sql`0`,
      );
      const titleScore = terms.reduce((acc, t) => sql`${acc} + (CASE WHEN ${like(sql`lower(p.title)`, t)} THEN 6 ELSE 0 END)`, sql`0`);
      const anyMatch = terms.reduce((acc, t) => sql`${acc} AND (${like(sql`ps.direct`, t)} OR ${like(sql`ps.body`, t)})`, sql`TRUE`);
      const matches = splitFields ? sql`
        SELECT coalesce(d.article_id, b.article_id) AS article_id,
          (CASE WHEN d.article_id IS NOT NULL THEN 3 ELSE 0 END) + (CASE WHEN b.article_id IS NOT NULL THEN 1 ELSE 0 END) AS part
        FROM (SELECT article_id FROM pool_search WHERE direct LIKE ${"%" + terms[0]! + "%"}) d
        FULL JOIN (SELECT article_id FROM pool_search WHERE body LIKE ${"%" + terms[0]! + "%"}) b ON b.article_id = d.article_id`
        : sql`SELECT ps.article_id, (${partScore}) AS part FROM pool_search ps WHERE ${anyMatch}`;
      type RankedRow = Omit<ItemRow, "id"> & { id: string | null; rel: number; total: number };
      // Equal relevance: a seated selected item first, then the higher quality score, then the newest.
      const tie = sql`(CASE WHEN p.selected AND p.seat THEN 1000 ELSE 0 END) + coalesce(p.score, 0)`;
      // A query naming a company also takes the articles about it, ranked first.
      const scored = entityTag ? sql`
          SELECT p.article_id, p.timeline_at, max(matches.part) + (${titleScore}) + (CASE WHEN p.tags @> ${[entityTag]}::text[] THEN 10 ELSE 0 END) AS rel, ${tie} AS tie
          FROM (SELECT article_id, part FROM matches UNION ALL SELECT article_id, 0 FROM publications WHERE tags @> ${[entityTag]}::text[]) matches
          JOIN publications p ON p.article_id = matches.article_id
          WHERE ${listedCondition(now)} ${filters}
          GROUP BY p.article_id, p.timeline_at, p.title, p.tags, p.selected, p.seat, p.score` : sql`
          SELECT p.article_id, p.timeline_at, matches.part + (${titleScore}) AS rel, ${tie} AS tie
          FROM matches JOIN publications p ON p.article_id = matches.article_id JOIN sources s ON s.id = p.source_id
          WHERE ${listedCondition(now)} ${filters}`;
      const result = await db<RankedRow[]>`
        WITH matches AS ${splitFields ? sql`MATERIALIZED` : sql`NOT MATERIALIZED`} (${matches}), scored AS MATERIALIZED (${scored}
        ), page AS MATERIALIZED (
          SELECT article_id, rel, tie FROM scored ORDER BY rel DESC, tie DESC, timeline_at DESC, article_id DESC
          LIMIT ${POOL_PAGE_SIZE} OFFSET ${offset}
        ), total AS (SELECT count(*) AS n FROM (SELECT 1 FROM scored LIMIT ${cap}) capped)
        SELECT hydrated.*, total.n AS total FROM total LEFT JOIN LATERAL (
          SELECT ${ITEM_COLUMNS}, page.rel, page.tie ${ITEM_FROM} JOIN page ON page.article_id = p.article_id
        ) hydrated ON true ORDER BY hydrated.rel DESC, hydrated.tie DESC, hydrated.timeline_at DESC, hydrated.id DESC`;
      const rows = result.filter((r): r is ItemRow & { rel: number; total: number } => r.id !== null);
      return { rows, total: Number(result[0]!.total) };
    }
    // Default search: newest first straight from the timeline index; the total from the pool's
    // search rows, where one- and two-character terms scan a small table instead of every item.
    const rows = await db<ItemRow[]>`
      WITH page AS (
        SELECT p.article_id FROM publications p WHERE ${listedCondition(now)} ${filters} ${matchOrSubject(directMatchCondition(terms))}
        ORDER BY p.timeline_at DESC, p.article_id DESC LIMIT ${POOL_PAGE_SIZE} OFFSET ${offset})
      SELECT ${ITEM_COLUMNS} ${ITEM_FROM} WHERE p.article_id IN (SELECT article_id FROM page)
      ORDER BY p.timeline_at DESC, p.article_id DESC`;
    const direct = terms.reduce((acc, t) => sql`${acc} AND ${like(sql`ps.direct`, t)}`, sql``);
    const { n } = one(await db<{ n: number }[]>`
      SELECT count(*) AS n FROM (SELECT 1 FROM pool_search ps JOIN publications p ON p.article_id = ps.article_id
        WHERE ${listedCondition(now)} ${filters} ${matchOrSubject(direct)} LIMIT ${cap}) t`);
    return { rows, total: Number(n) };
  };

  const { rows, total, groups, browseMeta } = q ? await withSearchCapacity(run) : await run(sql);
  const meta = browseMeta ?? one(await sql<PoolMeta[]>`
    SELECT (SELECT count(*) FROM publications p
      WHERE ${browsedCondition(now)} AND p.timeline_at >= ${todayStart} ${filters}) AS today_count,
      (SELECT max(p.updated_at) FROM publications p WHERE p.eligible) AS updated_at`);

  const holders = await seatHolders(rows, now);
  return {
    filters: { channel: query.channel, category: query.category, tag: query.tag, q, tab },
    items: rows.map((r) => (holders.has(r.id) ? { ...toFeedItemSummary(r), reason: null, sameEvent: holders.get(r.id)! } : toFeedItemSummary(r))),
    ...(groups && { groups }),
    page,
    pageCount: Math.min(POOL_MAX_PAGES, Math.max(1, Math.ceil(total / POOL_PAGE_SIZE))),
    total,
    todayCount: Number(meta.today_count),
    freshness: (meta.updated_at ?? now).toISOString(),
  };
}
