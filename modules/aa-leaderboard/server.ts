import type { preHandlerAsyncHookHandler } from "fastify";
import { sql } from "@aihot/backend/db";
import { defineServerModule } from "@aihot/backend/modules";
import { z } from "zod";
import { modelLogo } from "./model-logos.ts";

const API_URL = "https://artificialanalysis.ai/api/v2/language/models/free";
const REQUEST_TIMEOUT_MS = 15_000;

const pageSchema = z.object({
  intelligence_index_version: z.number().finite().positive(),
  pagination: z.object({
    page: z.number().int().positive(),
    total_pages: z.number().int().nonnegative(),
    has_more: z.boolean(),
  }),
  data: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    model_creator: z.object({ id: z.string() }).nullish().catch(null),
    evaluations: z.object({ artificial_analysis_intelligence_index: z.unknown() }).nullish(),
  })),
});

type RankedModel = { id: string; name: string; score: number; indexVersion: string; icon: string | null };

function apiKey() {
  return process.env.AA_API_KEY?.trim();
}

async function fetchPage(page: number, key: string) {
  let response: Response;
  try {
    response = await fetch(`${API_URL}?page=${page}`, {
      method: "GET",
      headers: { "x-api-key": key, accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error(`Artificial Analysis page ${page}: request failed`);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Artificial Analysis page ${page}: HTTP ${response.status}`);
  }
  const result = pageSchema.safeParse(await response.json().catch(() => null));
  if (!result.success) throw new Error(`Artificial Analysis page ${page}: invalid response`);
  return result.data;
}

export async function syncModelRankings() {
  const key = apiKey();
  if (!key) throw new Error("AA_API_KEY is missing");

  const models = new Map<string, RankedModel>();
  let indexVersion: number | undefined;
  let totalPages: number | undefined;
  let page = 1;
  for (;; page++) {
    const { intelligence_index_version: version, pagination, data } = await fetchPage(page, key);
    indexVersion ??= version;
    totalPages ??= pagination.total_pages;
    if (version !== indexVersion || pagination.page !== page || pagination.total_pages !== totalPages
      || pagination.has_more !== (page < totalPages)) {
      throw new Error(`Artificial Analysis page ${page}: pagination or index version changed during sync`);
    }
    for (const { id, name, model_creator, evaluations } of data) {
      const score = evaluations?.artificial_analysis_intelligence_index;
      if (typeof score !== "number" || !Number.isFinite(score) || models.has(id)) continue;
      models.set(id, { id, name, score, indexVersion: String(version), icon: modelLogo(model_creator?.id) });
    }
    if (!pagination.has_more) break;
  }

  const items = [...models.values()].sort((a, b) => b.score - a.score);
  await sql`
    INSERT INTO aa_model_ranking (items, updated_at)
    VALUES (${sql.json(items)}, now())
    ON CONFLICT (singleton) DO UPDATE SET items = EXCLUDED.items, updated_at = EXCLUDED.updated_at
  `;
  return { pages: page, models: items.length };
}

export async function loadModelRankings() {
  const [snapshot] = await sql<{ items: RankedModel[]; updated_at: Date }[]>`
    SELECT items, updated_at FROM aa_model_ranking WHERE singleton
  `;
  return snapshot
    ? { items: snapshot.items, updatedAt: snapshot.updated_at.toISOString() }
    : { items: [], updatedAt: null };
}

export const aaLeaderboard = defineServerModule({
  name: "aa-leaderboard",
  http: (app) => {
    app.get("/api/owner/model-rankings", {
      preHandler: app.getDecorator<preHandlerAsyncHookHandler>("requireEmployeeOwner"),
    }, async (_req, reply) => {
      return reply.header("Cache-Control", "private, no-store").send(await loadModelRankings());
    });
  },
  schedules: [{
    name: "aa.models-sync",
    cron: "0 */2 * * *",
    missed: "once",
    when: () => Boolean(apiKey()),
    run: syncModelRankings,
  }],
});
