import type { SourceDirectoryResponse, SourceHealth } from "@aihot/contracts/site";
import { sql } from "../db.ts";
import { publicSourceName } from "./rules.ts";

const PAGE_SIZE = 50;

export async function loadSourceDirectory({ q, status, page }: { q: string; status: SourceHealth | null; page: number }): Promise<SourceDirectoryResponse> {
  const rows = await sql<{ id: string; name: string; status: SourceHealth; last_fetch_at: Date | null }[]>`
    SELECT id, name, CASE WHEN enabled THEN health ELSE 'paused' END AS status, last_fetch_at
    FROM sources ORDER BY ('国内信源' = ANY(tags)) DESC, name, id`;
  const search = q.toLowerCase();
  // Search the displayed name so annotations kept for editors are never matched.
  const sources = rows.map((row) => ({ ...row, name: publicSourceName(row.name) }))
    .filter((row) => (!status || row.status === status) && row.name.toLowerCase().includes(search));
  const total = sources.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  page = Math.min(page, pageCount);
  const offset = (page - 1) * PAGE_SIZE;
  const items = sources.slice(offset, offset + PAGE_SIZE).map(({ last_fetch_at, ...row }) => ({
    ...row,
    lastFetchAt: last_fetch_at?.toISOString() ?? null,
  }));
  return { items, total, page, pageCount };
}
