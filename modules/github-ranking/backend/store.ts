import { sql } from "@aihot/backend/db";
import { loadModuleSnapshot } from "@aihot/backend/publication/module-snapshot";
import { completeReceipt } from "@aihot/backend/providers/receipts";
import type { GitHubRankingSnapshot } from "../types.ts";

export const rankingStore = {
  load: (): Promise<GitHubRankingSnapshot | null> => loadModuleSnapshot<GitHubRankingSnapshot>("github-ranking"),
  async publish(snapshot: GitHubRankingSnapshot, receiptId: number | null): Promise<void> {
    await sql.begin(async (tx) => {
      await tx`INSERT INTO settings (key, value, updated_by)
        VALUES ('module.github-ranking.snapshot', ${tx.json(snapshot as never)}, 'github-ranking')
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
      if (receiptId !== null) await completeReceipt(tx, receiptId);
    });
  },
};
