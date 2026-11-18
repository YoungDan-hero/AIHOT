import { defineServerModule } from "@aihot/backend/modules";
import type { GitHubRankingResponse } from "./types.ts";
import { refreshGitHubRanking } from "./backend/collect.ts";
import { rankingStore } from "./backend/store.ts";

export const githubRankingServer = defineServerModule({
  name: "github-ranking",
  schedules: [{ name: "github-ranking.refresh", cron: "0 */6 * * *", when: () => process.env.COLLECT_ENABLED === "true", run: refreshGitHubRanking }],
  http(app) {
    app.get("/api/site/github-ranking", async (_req, reply) => {
      const snapshot = await rankingStore.load();
      const response: GitHubRankingResponse = {
        snapshot,
        stale: !snapshot || !Number.isFinite(Date.parse(snapshot.fetchedAt)) || Date.now() - Date.parse(snapshot.fetchedAt) > 12 * 60 * 60 * 1000,
        refreshHours: 6,
      };
      return reply.header("Cache-Control", "public, max-age=60, s-maxage=60").send(response);
    });
  },
});
