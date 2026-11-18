import { Link } from "react-router";
import type { EmployeeVisitSession, EmployeeVisitsResponse } from "@aihot/contracts/site";
import { beijingDate, beijingTime } from "@aihot/contracts/time";
import type { Route } from "./+types/owner-visits";
import { IconChevronRight } from "../components/icons";
import { OwnerPage } from "../components/shell/OwnerPage";
import type { Screen } from "../components/shell/screens";
import { EmptyState } from "../components/ui/Page";
import { Pagination } from "../features/feed/DayList";
import { loadOr404 } from "../lib/api.server";
import { fullDateTime } from "../lib/format";
import { listPath, pageMeta } from "../lib/seo";

const path = "/owner/visits";
const title = "访客记录";

const pageLabels: Readonly<Record<string, string>> = {
  "/": "精选", "/all": "全部短剧动态", "/hot": "热点榜",
  "/daily": "短剧日报", "/daily/archive": "日报存档", "/weekly": "周报", "/monthly": "月报",
  "/sources": "信源", "/about": "关于", "/more": "我的", "/starred": "收藏", "/agent": "Agent 接入",
};

function describeVisit(pathname: string) {
  if (Object.hasOwn(pageLabels, pathname)) return pageLabels[pathname];
  if (pathname.startsWith("/items/")) return pathname.endsWith("/original") ? "资讯原文" : "资讯详情";
  if (pathname.startsWith("/story/")) return `热点专题 ${pathname.slice("/story/".length)}`;
  for (const report of ["/daily", "/weekly", "/monthly"]) {
    if (pathname.startsWith(`${report}/`)) return `${pageLabels[report]} ${pathname.slice(report.length + 1)}`;
  }
  return pathname;
}

export const handle: Screen = { home: "me", name: title };
export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "private, no-store" });
export const meta = () => pageMeta({ title, path, noindex: true, nofollow: true });

export async function loader({ request }: Route.LoaderArgs) {
  const requested = Number(new URL(request.url).searchParams.get("page"));
  const page = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  return loadOr404<EmployeeVisitsResponse>(`/api/owner/visits?page=${page}`, { ownerOnly: true, signal: request.signal });
}

function VisitSession({ visit }: { visit: EmployeeVisitSession }) {
  const start = fullDateTime(visit.startedAt);
  const last = fullDateTime(visit.lastVisitedAt);
  const lastLabel = beijingDate(visit.startedAt) === beijingDate(visit.lastVisitedAt) ? beijingTime(visit.lastVisitedAt) : last;
  return (
    <details className="disclosure group/visit">
      <summary className="grid min-h-11 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-3 text-[13px] hover:bg-bg-sunk focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-accent sm:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)_auto] sm:px-4 lg:text-[14px]">
        <span className="min-w-0 wrap-anywhere font-semibold text-ink">
          {visit.name}
          {visit.historical && <span className="ml-1.5 text-[11px] font-normal text-ink-4">历史</span>}
        </span>
        <span className="num col-span-2 row-start-2 min-w-0 wrap-anywhere text-ink-3 sm:col-span-1 sm:row-auto">
          <time dateTime={visit.startedAt}>{start}</time>
          {last !== start && <> – <time dateTime={visit.lastVisitedAt}>{lastLabel}</time></>}
        </span>
        <span className="col-start-2 row-start-1 flex items-center gap-2 text-[12px] text-ink-3 sm:col-start-3 sm:row-auto">
          <span><span className="num">{visit.pages.length}</span> 个页面 · <span className="num">{visit.articles.length}</span> 篇资讯</span>
          <IconChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-4 transition-transform group-open/visit:rotate-90" />
        </span>
      </summary>
      <div className="grid min-w-0 gap-3 border-t border-line-soft bg-bg-sunk/50 px-3 py-3 text-[13px] sm:grid-cols-2 sm:px-4">
        <div className="min-w-0">
          <h2 className="font-semibold text-ink">访问页面</h2>
          {visit.pages.length > 0 ? (
            <ul className="mt-1 space-y-1 text-ink-2">
              {visit.pages.map((entry) => (
                <li key={entry.path} className="wrap-anywhere">
                  {describeVisit(entry.path)}
                  {entry.count > 1 && <span className="num ml-2 text-ink-4">×{entry.count}</span>}
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-ink-4">无</p>}
        </div>
        <div className="min-w-0">
          <h2 className="font-semibold text-ink">点开的资讯</h2>
          {visit.articles.length > 0 ? (
            <ul className="mt-1 space-y-1 text-ink-2">
              {visit.articles.map((entry) => (
                <li key={entry.path} className="wrap-anywhere">
                  {entry.title ? <Link to={entry.path} className="font-medium text-accent hover:underline">{entry.title}</Link> : "资讯已不可用"}
                  {entry.count > 1 && <span className="num ml-2 text-ink-4">×{entry.count}</span>}
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-ink-4">无</p>}
        </div>
      </div>
    </details>
  );
}

export default function OwnerVisits({ loaderData }: Route.ComponentProps) {
  const { items, page, pageCount, total } = loaderData;
  return (
    <OwnerPage title={title}>
      <div className="my-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[12px] text-ink-3 lg:mt-5">
        <p>共 <span className="num">{total.toLocaleString("zh-CN")}</span> 次访问</p>
        {items.length > 0 && <span>北京时间</span>}
        {items.some((visit) => visit.historical) && <p className="basis-full">历史记录按当时的飞书花名归组。</p>}
      </div>
      <div className="card overflow-hidden">
        {items.length === 0 ? <EmptyState title="暂无访客记录" /> : (
          <ul className="divide-y divide-line-soft" aria-label="访问列表">
            {items.map((visit) => <li key={visit.id}><VisitSession visit={visit} /></li>)}
          </ul>
        )}
      </div>
      <Pagination page={page} pageCount={pageCount} href={(p) => listPath(path, { page: p > 1 ? p : null })} />
    </OwnerPage>
  );
}
