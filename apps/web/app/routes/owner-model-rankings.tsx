import type { Route } from "./+types/owner-model-rankings";
import { OwnerPage } from "../components/shell/OwnerPage";
import type { Screen } from "../components/shell/screens";
import { EmptyState } from "../components/ui/Page";
import { Pagination } from "../features/feed/DayList";
import { loadOr404 } from "../lib/api.server";
import { fullDateTime } from "../lib/format";
import { listPath, pageMeta } from "../lib/seo";

const path = "/owner/model-rankings";
const title = "模型能力榜";
const PAGE_SIZE = 40;

type ModelRanking = { id: string; name: string; score: number; indexVersion: string | null; icon?: string | null };
type RankingSnapshot = { items: ModelRanking[]; updatedAt: string | null };

export const handle: Screen = { home: "me", name: title };
export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "private, no-store" });
export const meta = () => pageMeta({ title, path, noindex: true, nofollow: true });

export async function loader({ request }: Route.LoaderArgs) {
  const snapshot = await loadOr404<RankingSnapshot>("/api/owner/model-rankings", { ownerOnly: true, signal: request.signal });
  const pageCount = Math.max(1, Math.ceil(snapshot.items.length / PAGE_SIZE));
  const requested = Number(new URL(request.url).searchParams.get("page"));
  const page = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, pageCount) : 1;
  const start = (page - 1) * PAGE_SIZE;
  return { items: snapshot.items.slice(start, start + PAGE_SIZE), page, pageCount, start, updatedAt: snapshot.updatedAt };
}

export default function OwnerModelRankings({ loaderData }: Route.ComponentProps) {
  const { items, page, pageCount, start, updatedAt } = loaderData;
  return (
    <OwnerPage title={title}>
      <div className="my-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[12px] text-ink-3 lg:mt-5">
        <a href="https://artificialanalysis.ai/" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
          数据来源：Artificial Analysis
        </a>
        <p>
          上次更新时间{" "}
          {updatedAt ? <time dateTime={updatedAt} className="num">{fullDateTime(updatedAt)}（北京时间）</time> : "尚未同步"}
        </p>
      </div>
      <div className="card overflow-hidden">
        {items.length === 0 ? <EmptyState title={updatedAt ? "暂无带指数分数的模型" : "暂无同步数据"} /> : (
          <table className="w-full table-fixed text-left text-[13px] lg:text-[14px]">
            <caption className="sr-only">Artificial Analysis 模型能力榜，按原始指数分数降序排列</caption>
            <thead className="border-b border-line bg-bg-sunk text-[12px] text-ink-3">
              <tr>
                <th scope="col" className="w-[13%] px-2 py-2.5 font-medium sm:w-[10%] sm:px-4">排名</th>
                <th scope="col" className="px-2 py-2.5 font-medium sm:px-4">模型与档位</th>
                <th scope="col" className="w-[23%] px-2 py-2.5 text-right font-medium sm:px-4">分数</th>
                <th scope="col" className="w-[19%] px-2 py-2.5 text-right font-medium sm:w-[15%] sm:px-4">指数版本</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {items.map((model, index) => (
                <tr key={model.id}>
                  <td className="num px-2 py-3 text-ink-3 sm:px-4">{start + index + 1}</td>
                  <th scope="row" className="wrap-anywhere px-2 py-3 font-medium text-ink sm:px-4">
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-control bg-bg-sunk text-[10px] font-semibold text-ink-3 ring-1 ring-line">
                        {model.icon && /^\/model-logos\/[a-z0-9_-]+\.(svg|png|jpe?g)$/.test(model.icon) ? (
                          <img src={model.icon} alt="" width={24} height={24} loading="lazy" decoding="async" className="size-6 rounded-control bg-white object-contain p-1" />
                        ) : Array.from(model.name)[0]?.toUpperCase()}
                      </span>
                      <span className="min-w-0">{model.name}</span>
                    </span>
                  </th>
                  <td className="num wrap-anywhere px-2 py-3 text-right font-semibold text-ink sm:px-4">{model.score}</td>
                  <td className="num wrap-anywhere px-2 py-3 text-right text-ink-3 sm:px-4">
                    {model.indexVersion === null ? "—" : /^\d/.test(model.indexVersion) ? `v${model.indexVersion}` : model.indexVersion}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Pagination page={page} pageCount={pageCount} href={(p) => listPath(path, { page: p > 1 ? p : null })} />
    </OwnerPage>
  );
}
