import type { EmployeeStarredItem } from "@aihot/contracts/site";
import { one, sql } from "../db.ts";
import { hasItemPage, publicSourceName } from "./rules.ts";
import { releasedCondition } from "./scope.ts";

const STARRED_LIMIT = 500;

interface SavedRow {
  id: string;
  saved_at: Date;
  title: string | null;
  summary: string | null;
  published_at: Date | null;
  score: number | null;
  selected: boolean | null;
  visibility: string | null;
  source_mode: string | null;
  source_name: string | null;
}

export async function loadEmployeeStars(account: string): Promise<EmployeeStarredItem[]> {
  const rows = await sql<SavedRow[]>`
    SELECT b.article_id AS id, b.saved_at, p.title, p.summary, p.published_at, p.score, p.selected, p.visibility,
      s.participation_mode AS source_mode, s.name AS source_name
    FROM employee_starred b
    LEFT JOIN publications p ON p.article_id = b.article_id AND ${releasedCondition(new Date())}
    LEFT JOIN sources s ON s.id = p.source_id
    WHERE b.account_key = ${account}
    ORDER BY b.saved_at DESC, b.article_id DESC`;
  return rows.map((row) => {
    const savedAt = row.saved_at.toISOString();
    if (!row.visibility || !row.source_mode || !hasItemPage({ visibility: row.visibility, sourceMode: row.source_mode })) {
      return { id: row.id, savedAt, title: "资讯暂不可查看", status: "unavailable",
        summary: null, publishedAt: null, sourceName: "", score: null, aiSelected: false };
    }
    const summaryOnly = row.visibility === "summary-only";
    return {
      id: row.id, savedAt, title: row.title!, summary: row.summary,
      publishedAt: row.published_at?.toISOString() ?? null, sourceName: publicSourceName(row.source_name!),
      score: summaryOnly || row.score === null ? null : Math.round(row.score), aiSelected: !summaryOnly && !!row.selected,
      status: summaryOnly ? "summary-only" : "public",
    };
  });
}

export async function saveEmployeeStar(account: string, id: string): Promise<"saved" | "not_found" | "full"> {
  return sql.begin(async (tx) => {
    // Enforce the account limit when two devices add favorites at the same time.
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${account}, 0))`;
    const [item] = await tx<{ visibility: string; source_mode: string }[]>`
      SELECT p.visibility, s.participation_mode AS source_mode
      FROM publications p JOIN sources s ON s.id = p.source_id
      WHERE p.article_id = ${id} AND ${releasedCondition(new Date())}`;
    if (!item || !hasItemPage({ visibility: item.visibility, sourceMode: item.source_mode })) return "not_found";
    const { saved, room } = one(await tx<{ saved: boolean; room: boolean }[]>`
      SELECT count(*) FILTER (WHERE article_id = ${id}) > 0 AS saved, count(*) < ${STARRED_LIMIT} AS room
      FROM employee_starred WHERE account_key = ${account}`);
    if (saved) return "saved";
    if (!room) return "full";
    await tx`INSERT INTO employee_starred (account_key, article_id) VALUES (${account}, ${id}) ON CONFLICT DO NOTHING`;
    return "saved";
  });
}

export async function removeEmployeeStar(account: string, id: string): Promise<void> {
  await sql`DELETE FROM employee_starred WHERE account_key = ${account} AND article_id = ${id}`;
}
