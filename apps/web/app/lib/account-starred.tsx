import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { EmployeeStarredItem, EmployeeStarredResponse } from "@aihot/contracts/site";

const PATH = "/api/employee/starred";
const EXPIRED = "飞书登录已失效，请刷新页面重新登录。";

type AccountStarred = {
  items: EmployeeStarredItem[] | null;
  pending: ReadonlySet<string>;
  loadError: string | null;
  refresh: () => Promise<void>;
  save: (item: Omit<EmployeeStarredItem, "status" | "savedAt">) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
};

const Context = createContext<AccountStarred | null>(null);

export function useAccountStarred() {
  return useContext(Context);
}

export function AccountStarredProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<EmployeeStarredItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fetching = useRef<AbortController | null>(null);
  const changing = useRef(new Set<string>());
  const expired = useRef(false);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  const clearSession = useCallback(() => {
    expired.current = true;
    setItems(null);
    setLoadError(EXPIRED);
  }, []);

  const refresh = useCallback(async () => {
    if (changing.current.size || fetching.current) return;
    const request = new AbortController();
    fetching.current = request;
    setLoadError(null);
    try {
      const res = await fetch(PATH, {
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]), cache: "no-store", redirect: "error",
      });
      if (request.signal.aborted) return;
      if (res.status === 401) return clearSession();
      if (!res.ok) throw new Error("Couldn't load bookmarks");
      const { items } = await res.json() as EmployeeStarredResponse;
      if (!request.signal.aborted) {
        expired.current = false;
        setItems(items);
      }
    } catch {
      if (!request.signal.aborted) setLoadError("收藏暂时无法同步，请稍后重试。");
    } finally {
      if (fetching.current === request) fetching.current = null;
    }
  }, [clearSession]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      fetching.current?.abort();
      fetching.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const change = async (id: string, item?: Omit<EmployeeStarredItem, "status" | "savedAt">) => {
    if (expired.current || changing.current.has(id)) return false;
    changing.current.add(id);
    setPending(new Set(changing.current));
    setNotice(null);
    // A read started before a successful write must not put the old list back.
    fetching.current?.abort();
    fetching.current = null;
    try {
      const res = await fetch(`${PATH}/${encodeURIComponent(id)}`, {
        method: item ? "PUT" : "DELETE", signal: AbortSignal.timeout(10_000), cache: "no-store", redirect: "error",
      });
      if (res.status === 401) {
        clearSession();
        setNotice(EXPIRED);
        return false;
      }
      if (!res.ok) {
        setNotice(res.status === 409 ? "收藏已达上限，请取消一条后再试。"
          : res.status === 404 ? "这条内容暂时无法收藏。" : "收藏未更新，请稍后重试。");
        return false;
      }
      if (!expired.current) {
        setItems((old) => {
          const remaining = (old ?? []).filter((entry) => entry.id !== id);
          return item ? [{ ...item, status: "public", savedAt: new Date().toISOString() }, ...remaining] : remaining;
        });
      }
      return true;
    } catch {
      setNotice("收藏未更新，请稍后重试。");
      return false;
    } finally {
      changing.current.delete(id);
      setPending(new Set(changing.current));
      if (!expired.current) void refresh();
    }
  };

  return (
    <Context.Provider value={{ items, pending, loadError, refresh, save: (item) => change(item.id, item), remove: change }}>
      {children}
      {notice && (
        <p role="status" className="fixed bottom-[calc(80px+env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[13px] text-bg shadow-[var(--shadow-pop)] lg:bottom-8">
          {notice}
        </p>
      )}
    </Context.Provider>
  );
}
