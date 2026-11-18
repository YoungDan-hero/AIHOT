import { useLoaderData } from "react-router";
import { IconArrowUpRight, IconGithub } from "@aihot/web/components/icons";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { Screen } from "@aihot/web/components/shell/screens";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { cachedPage, loadOr404 } from "@aihot/web/lib/api.server";
import { fullDateTime } from "@aihot/web/lib/format";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta } from "@aihot/web/lib/seo";
import type { GitHubRankingResponse } from "../types";

export const handle: Screen = { tab: "me", name: "GitHub周榜" };
export { pageHeaders as headers } from "@aihot/web/lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: { request: Request }) {
  const upstream = new Headers();
  const ranking = await loadOr404<GitHubRankingResponse>("/api/site/github-ranking", {
    signal: request.signal,
    responseHeaders: upstream,
  });
  return cachedPage(300, { ranking }, upstream);
}

export function meta() {
  return pageMeta({
    title: "GitHub周榜",
    description: "GitHub Trending 周榜项目，按本周涨星排序，查看项目简介、开发语言与 Star 数。",
    path: "/github",
  });
}

export default function GitHubRankingPage() {
  const { ranking } = useLoaderData<typeof loader>();
  const { snapshot, stale, refreshHours } = ranking;

  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-10">
      <PhoneBar back={{ to: "/more", label: "我的" }} title="GitHub周榜" large />
      <header className="pb-5 lg:pt-1">
        <h1 className="hidden items-center gap-2.5 text-[24px] font-semibold leading-[1.3] text-ink lg:flex">
          <IconGithub size={25} />
          GitHub周榜
        </h1>
        <p className="text-[13px] leading-relaxed text-ink-3 lg:mt-3">GitHub Trending 周榜项目，按本周涨星排序</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] leading-relaxed text-ink-4">
          {snapshot && <span>更新于 <time dateTime={snapshot.fetchedAt} className="num">{fullDateTime(snapshot.fetchedAt)}</time>（北京时间）</span>}
          <span>每 {refreshHours} 小时检查更新</span>
          <a
            href={snapshot?.sourceUrl ?? "https://github.com/trending?since=weekly"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-8 items-center gap-0.5 text-accent hover:underline"
          >
            GitHub 原榜 <IconArrowUpRight size={13} />
          </a>
        </div>
      </header>

      {stale && snapshot && (
        <p role="status" className="mb-4 rounded-control bg-amber-soft px-4 py-3 text-[13px] leading-relaxed text-amber-ink">
          当前显示上次采集结果，更新暂有延迟。
        </p>
      )}

      {!snapshot || snapshot.items.length === 0 ? (
        <div className="card">
          <EmptyState title={snapshot ? "本次榜单暂无项目" : "还没有采集到周榜"}>
            {snapshot ? "后续采集到项目后，会在这里显示。" : "首次采集完成后，会在这里显示项目和本周新增 Star。"}
          </EmptyState>
        </div>
      ) : (
        <ol aria-label="GitHub 周榜" className="card divide-y divide-line-soft overflow-hidden">
          {snapshot.items.map((item) => (
            <li key={item.repo} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2 gap-y-3 px-4 py-5 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-6">
              <span className={`num row-span-2 pt-0.5 text-[19px] font-semibold leading-snug sm:row-span-1 ${item.rank <= 3 ? "text-accent" : "text-ink-4"}`} aria-label={`第 ${item.rank} 名`}>
                {String(item.rank).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <h2 className="text-[16px] font-semibold leading-snug text-ink">
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-block py-1 -my-1 [overflow-wrap:anywhere] hover:text-accent hover:underline">
                    {item.repo}<IconArrowUpRight size={13} className="ml-1 inline-block align-baseline text-ink-4" />
                  </a>
                </h2>
                <p className="mt-2 text-[13.5px] leading-[1.75] text-ink-3 [overflow-wrap:anywhere]">
                  {item.descriptionZh || item.description || "暂无项目简介"}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] leading-relaxed text-ink-4">
                  {item.language && <span>{item.language}</span>}
                  <span>总 Star <span className="num text-ink-3">{item.stars.toLocaleString("en-US")}</span></span>
                </div>
              </div>
              <div className="col-start-2 flex items-baseline gap-1.5 sm:col-start-3 sm:flex-col sm:items-end sm:justify-center sm:gap-1 sm:pl-5">
                <span className="num whitespace-nowrap text-[21px] font-semibold leading-none tracking-[-0.02em] text-accent">+{item.weeklyStars.toLocaleString("en-US")}</span>
                <span className="whitespace-nowrap text-[11.5px] text-ink-4">本周 Star</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
