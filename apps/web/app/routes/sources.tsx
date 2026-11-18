import { Form, Link, redirect, useNavigation } from "react-router";
import { SOURCE_HEALTH_LABELS, type SourceDirectoryResponse, type SourceHealth } from "@aihot/contracts/site";
import { beijingDate, beijingTime } from "@aihot/contracts/time";
import type { Route } from "./+types/sources";
import { IconSearch } from "../components/icons";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";
import { Badge } from "../components/ui/Badge";
import { buttonClass, Select } from "../components/ui/Controls";
import { EmptyState } from "../components/ui/Page";
import { Pagination } from "../features/feed/DayList";
import { loadOr404 } from "../lib/api.server";
import { listPath, pageMeta } from "../lib/seo";

export const handle: Screen = { home: "me", name: "信源" };
export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "no-store" });
export const meta: Route.MetaFunction = () => pageMeta({ title: "信源", path: "/sources", noindex: true });

const tones = { ok: "ok", degraded: "amber", failing: "hot", paused: "neutral", unknown: "neutral" } as const satisfies Record<SourceHealth, string>;

export async function loader({ request }: Route.LoaderArgs) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim().slice(0, 120) ?? "";
  const requestedStatus = searchParams.get("status");
  const status = requestedStatus && Object.hasOwn(SOURCE_HEALTH_LABELS, requestedStatus) ? requestedStatus : "";
  const requestedPage = Number(searchParams.get("page"));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const filters = { q, status };
  const directory = await loadOr404<SourceDirectoryResponse>(
    listPath("/api/site/sources", { ...filters, page: page > 1 ? page : null }),
    { signal: request.signal },
  );
  if (page !== directory.page) {
    throw redirect(listPath("/sources", { ...filters, page: directory.page > 1 ? directory.page : null }));
  }
  return { directory, filters };
}

export default function Sources({ loaderData }: Route.ComponentProps) {
  const { directory, filters } = loaderData;
  const { q, status } = filters;
  const { items, total, page, pageCount } = directory;
  const navigation = useNavigation();
  const busy = navigation.state === "loading" && navigation.location?.pathname === "/sources";
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-8">
      <PhoneBar title="信源" back={{ to: "/more", label: "我的" }} large />
      <h1 className="hidden text-[24px] font-semibold leading-[1.3] text-ink lg:block">信源</h1>
      <Form key={JSON.stringify(filters)} method="get" action="/sources" role="search" aria-label="筛选信源" className="flex flex-wrap items-center gap-2 lg:mt-4">
        <label className="relative w-full sm:max-w-72">
          <span className="sr-only">信源名称</span>
          <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="搜索信源名称"
            maxLength={120}
            className="h-11 w-full rounded-full border border-line-strong bg-surface pl-9 pr-3 text-[16px] text-ink outline-none transition-colors placeholder:text-ink-4 hover:border-ink-4 focus:border-accent lg:h-9 lg:text-[13.5px]"
          />
        </label>
        <Select aria-label="信源状态" name="status" defaultValue={status}>
          <option value="">全部状态</option>
          {Object.entries(SOURCE_HEALTH_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <button type="submit" className={buttonClass("primary")}>筛选</button>
        {(q || status) && <Link to="/sources" className={buttonClass()}>清除筛选</Link>}
      </Form>
      <div className="my-3 flex items-baseline justify-between gap-2 text-[12px] text-ink-3 lg:mt-5">
        <p role="status">共 <span className="num">{total.toLocaleString("zh-CN")}</span> 个信源</p>
        {items.length > 0 && <span>北京时间</span>}
      </div>
      <div className="card overflow-hidden" aria-busy={busy}>
        {items.length === 0 ? (
          <EmptyState title="没有符合条件的信源">可以换个名称或选择其他状态。</EmptyState>
        ) : (
          <table className="w-full table-fixed text-left text-[13px] lg:text-[14px]">
            <caption className="sr-only">信源列表，采集时间为北京时间</caption>
            <thead className="border-b border-line bg-bg-sunk text-[12px] text-ink-3">
              <tr>
                <th scope="col" className="px-2.5 py-2.5 font-medium sm:px-4">信源名称</th>
                <th scope="col" className="w-[28%] px-2.5 py-2.5 font-medium sm:w-[20%] sm:px-4">状态</th>
                <th scope="col" className="w-[36%] px-2.5 py-2.5 font-medium sm:w-[29%] sm:px-4">最近采集</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {items.map((source) => (
                <tr key={source.id}>
                  <th scope="row" className="px-2.5 py-3 font-medium wrap-anywhere text-ink sm:px-4">{source.name}</th>
                  <td className="px-2.5 py-3 sm:px-4">
                    <Badge tone={tones[source.status]} dot className="whitespace-nowrap">{SOURCE_HEALTH_LABELS[source.status]}</Badge>
                  </td>
                  <td className="px-2.5 py-3 text-ink-3 sm:px-4">
                    {source.lastFetchAt
                      ? <time dateTime={source.lastFetchAt} className="num">{beijingDate(source.lastFetchAt)} {beijingTime(source.lastFetchAt)}</time>
                      : "尚未采集"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Pagination page={page} pageCount={pageCount} href={(p) => listPath("/sources", { ...filters, page: p > 1 ? p : null })} />
    </div>
  );
}
