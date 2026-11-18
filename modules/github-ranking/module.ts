import { defineModule } from "@aihot/contracts/modules";

export const githubRankingModule = defineModule({
  name: "github-ranking",
  pages: [{ path: "github", file: "web/page.tsx" }],
  apiPaths: [/^\/api\/site\/github-ranking\/?$/],
});
