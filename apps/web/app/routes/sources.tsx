import { useState, type FormEvent } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";
import { SOURCE_HEALTH_LABELS, type SourceDirectoryResponse, type SourceHealth } from "@aihot/contracts/site";
import { beijingDate, beijingTime } from "@aihot/contracts/time";
import type { Route } from "./+types/sources";
import { IconExternal, IconSearch } from "../components/icons";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";
import { Badge } from "../components/ui/Badge";
import { buttonClass, Select } from "../components/ui/Controls";
import { EmptyState } from "../components/ui/Page";
import { Sheet } from "../components/ui/Sheet";
import { Pagination } from "../features/feed/DayList";
import { loadOr404 } from "../lib/api.server";
import { listPath, pageMeta } from "../lib/seo";

export const handle: Screen = { home: "me", name: "信源" };
export const headers: Route.HeadersFunction = () => ({ "Cache-Control": "no-store" });
export const meta: Route.MetaFunction = () => pageMeta({ title: "信源", path: "/sources", noindex: true });

const tones = { ok: "ok", degraded: "amber", failing: "hot", paused: "neutral", unknown: "neutral" } as const satisfies Record<SourceHealth, string>;

function SourceFeedback({ recipient }: { recipient: SourceDirectoryResponse["feedbackRecipient"] }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "saved">("idle");
  const [error, setError] = useState("");
  const inputClass = "h-11 w-full rounded-control border border-line-strong bg-bg px-3 text-[16px] text-ink outline-none focus:border-accent";
  const close = () => { if (state !== "sending") setOpen(false); };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending") return;
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get("name") ?? "").trim();
    const url = String(fields.get("url") ?? "").trim();
    setError("");
    setState("sending");
    try {
      const response = await fetch("/api/site/source-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => null);
        setError(response.status < 500 && typeof problem?.detail === "string" ? problem.detail : "提交失败，请稍后再试。");
        setState("idle");
        return;
      }
      setState("saved");
    } catch {
      setError("提交失败，请稍后再试。");
      setState("idle");
    }
  }

  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <p id="source-feedback-hint" className="text-right text-[13px] leading-snug text-ink-2">没找到想看的信源？欢迎推荐。</p>
        <button type="button" aria-haspopup="dialog" aria-describedby="source-feedback-hint" className={`${buttonClass()} shrink-0`} onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          setError("");
          setState("idle");
          setOpen(true);
        }}>信源反馈</button>
      </div>
      <Sheet open={open} onClose={close} title="信源反馈" centered>
        {state === "saved" ? (
          <div className="space-y-4 px-5">
            <p role="status" className="text-[14px] text-ink">信源反馈已提交。</p>
            <div className="flex justify-end">
              <button type="button" className={buttonClass("primary")} onClick={close}>完成</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3 px-5">
            <label className="block space-y-1.5 text-[14px] text-ink">
              <span>信源名称</span>
              <input name="name" type="text" required readOnly={state === "sending"} maxLength={120} className={inputClass} />
            </label>
            <label className="block space-y-1.5 text-[14px] text-ink">
              <span>信源链接</span>
              <input name="url" type="url" required readOnly={state === "sending"} maxLength={2048} placeholder="https://" className={inputClass} />
            </label>
            {recipient && (
              <div className="flex items-center gap-2 text-[13px] text-ink-2">
                <span className="shrink-0">通知</span>
                <a
                  href={recipient.chatUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`在飞书中与${recipient.name}聊天`}
                  className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-control px-2 text-ink transition-colors hover:bg-bg-sunk hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <img src={recipient.avatarUrl} alt="" width={28} height={28} referrerPolicy="no-referrer" className="size-7 shrink-0 rounded-full bg-bg-sunk object-cover" />
                  <span className="truncate font-medium">{recipient.name}</span>
                  <IconExternal size={13} className="shrink-0 text-ink-3" />
                </a>
              </div>
            )}
            {error && <p role="alert" className="text-[13px] text-ink">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className={buttonClass()} disabled={state === "sending"} onClick={close}>取消</button>
              <button type="submit" className={buttonClass("primary")} disabled={state === "sending"}>
                {state === "sending" ? "提交中…" : "提交反馈"}
              </button>
            </div>
          </form>
        )}
      </Sheet>
    </>
  );
}

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
      <PhoneBar title="信源" back={{ to: "/more", label: "我的" }} />
      <div className="flex items-center justify-between gap-3 pb-3 pt-0.5 lg:p-0">
        <h1 data-page-title="" className="shrink-0 text-[30px] font-bold leading-[1.25] tracking-[-0.01em] text-ink lg:text-[24px] lg:font-semibold lg:leading-[1.3]">信源</h1>
        <SourceFeedback recipient={directory.feedbackRecipient} />
      </div>
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
            className="block h-11 w-full rounded-full border border-line-strong bg-surface pl-9 pr-3 text-[16px] text-ink outline-none transition-colors placeholder:text-ink-4 hover:border-ink-4 focus:border-accent lg:h-9 lg:text-[13.5px]"
          />
        </label>
        <Select aria-label="信源状态" name="status" defaultValue={status} className="lg:[&>select]:h-9 lg:[&>select]:text-[13.5px]">
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
