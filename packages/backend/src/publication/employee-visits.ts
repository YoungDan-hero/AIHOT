import type { EmployeeVisitSession, EmployeeVisitsResponse } from "@aihot/contracts/site";
import { ARTICLE_ID_PATTERN } from "@aihot/contracts/taxonomy";
import { one, sql } from "../db.ts";
import { hasItemPage } from "./rules.ts";
import { releasedCondition } from "./scope.ts";

const PAGES = new Set(["/", "/all", "/hot", "/daily", "/daily/archive", "/weekly", "/monthly", "/sources", "/about", "/more", "/starred", "/agent"]);
const DETAIL_PAGE = /^(?:\/daily\/\d{4}-\d{2}-\d{2}|\/weekly\/\d{4}-W\d{2}|\/monthly\/\d{4}-\d{2}|\/story\/[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i;
const PAGE_SIZE = 40;
const MISSING_NAME = "飞书未返回花名";

interface VisitPath { path: string; articleId: string | null }
interface ArticlePage { visibility: string | null; source_mode: string | null }
type VisitArticle = EmployeeVisitSession["articles"][number] & ArticlePage;
type SessionRow = { total: number; page_count: number; page: number } & ({ id: null } | {
  id: string;
  name: string;
  started_at: Date;
  last_at: Date;
  historical: boolean;
  pages: EmployeeVisitSession["pages"];
  articles: VisitArticle[];
});

export function parseVisitPath(value: unknown): VisitPath | null {
  if (typeof value !== "string" || value.length > 160 || /\s/.test(value)) return null;
  if (PAGES.has(value) || DETAIL_PAGE.test(value)) return { path: value, articleId: null };
  const id = /^\/items\/([^/]+)(?:\/original)?$/.exec(value)?.[1];
  return id && ARTICLE_ID_PATTERN.test(id) ? { path: value, articleId: id } : null;
}

function articlePageIsAvailable(row: ArticlePage): boolean {
  return !!row.visibility && !!row.source_mode && hasItemPage({ visibility: row.visibility, sourceMode: row.source_mode });
}

export async function recordEmployeeVisit(account: string, name: string | null | undefined, visit: VisitPath): Promise<void> {
  if (visit.articleId) {
    const [article] = await sql<ArticlePage[]>`
      SELECT p.visibility, s.participation_mode AS source_mode
      FROM publications p JOIN sources s ON s.id = p.source_id
      WHERE p.article_id = ${visit.articleId} AND ${releasedCondition(new Date())}`;
    if (!article || !articlePageIsAvailable(article)) return;
  }
  await sql`INSERT INTO employee_visits (account_key, name, path, article_id) VALUES (${account}, ${name ?? MISSING_NAME}, ${visit.path}, ${visit.articleId})`;
}

export async function loadEmployeeVisits(requestedPage: number): Promise<EmployeeVisitsResponse> {
  // Legacy visits had no account key. Group named records separately and keep each unnamed record distinct.
  const rows = await sql<SessionRow[]>`
    WITH identified AS (
      SELECT *, coalesce(account_key, CASE WHEN name = ${MISSING_NAME} THEN 'legacy-row:' || id
        ELSE 'legacy-name:' || name END) AS visitor
      FROM employee_visits
    ), ordered AS (
      SELECT *, lag(visited_at) OVER (PARTITION BY visitor ORDER BY visited_at, id) AS previous_at
      FROM identified
    ), grouped AS (
      SELECT *, count(*) FILTER (WHERE previous_at IS NULL OR visited_at >= previous_at + interval '30 minutes')
        OVER (PARTITION BY visitor ORDER BY visited_at, id) AS visit_number
      FROM ordered
    ), sessions AS (
      SELECT visitor, visit_number, min(id) AS id, min(visited_at) AS started_at, max(visited_at) AS last_at,
        (array_agg(name ORDER BY visited_at DESC, id DESC))[1] AS name, bool_and(account_key IS NULL) AS historical
      FROM grouped GROUP BY visitor, visit_number
    ), totals AS (
      SELECT count(*)::int AS total, greatest(1, ceil(count(*)::numeric / ${PAGE_SIZE})::int) AS page_count FROM sessions
    ), pagination AS (
      SELECT *, least(${requestedPage}::int, page_count) AS page FROM totals
    ), selected AS (
      SELECT * FROM sessions ORDER BY last_at DESC, id DESC
      LIMIT ${PAGE_SIZE} OFFSET (SELECT (page - 1)::bigint * ${PAGE_SIZE} FROM pagination)
    ), actions AS (
      SELECT s.id, v.article_id, coalesce('/items/' || v.article_id, v.path) AS target_path,
        count(*)::int AS count, min(v.visited_at) AS first_at, min(v.id) AS first_id
      FROM selected s JOIN grouped v USING (visitor, visit_number)
      GROUP BY s.id, v.article_id, target_path
    )
    SELECT pg.total, pg.page_count, pg.page, s.id::text, s.name, s.started_at, s.last_at, s.historical,
      coalesce(jsonb_agg(jsonb_build_object('path', a.target_path, 'count', a.count) ORDER BY a.first_at, a.first_id)
        FILTER (WHERE a.article_id IS NULL AND a.target_path IS NOT NULL), '[]') AS pages,
      coalesce(jsonb_agg(jsonb_build_object('path', a.target_path, 'count', a.count, 'title', p.title,
        'visibility', p.visibility, 'source_mode', source.participation_mode) ORDER BY a.first_at, a.first_id)
        FILTER (WHERE a.article_id IS NOT NULL), '[]') AS articles
    FROM pagination pg LEFT JOIN selected s ON true LEFT JOIN actions a ON a.id = s.id
    LEFT JOIN publications p ON p.article_id = a.article_id AND ${releasedCondition(new Date())}
    LEFT JOIN sources source ON source.id = p.source_id
    GROUP BY pg.total, pg.page_count, pg.page, s.id, s.name, s.started_at, s.last_at, s.historical
    ORDER BY s.last_at DESC, s.id DESC`;
  const { total, page, page_count: pageCount } = one(rows);
  const items = rows.flatMap((row) => row.id === null ? [] : [{
    id: row.id, name: row.name, startedAt: row.started_at.toISOString(), lastVisitedAt: row.last_at.toISOString(),
    historical: row.historical, pages: row.pages,
    articles: row.articles.map((article) => ({
      path: article.path, count: article.count, title: articlePageIsAvailable(article) ? article.title : null,
    })),
  }]);
  return { items, page, pageCount, total };
}
