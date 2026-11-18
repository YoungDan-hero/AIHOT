import { IconGithub } from "@aihot/web/components/icons";
import { defineWebModule } from "@aihot/web/modules";

export const githubRankingWeb = defineWebModule({
  name: "github-ranking",
  sidebar: { section: "内容", items: [{ to: "/github", label: "GitHub周榜", icon: IconGithub }] },
  tools: [{ to: "/github", label: "GitHub周榜", icon: <IconGithub size={20} /> }],
});
