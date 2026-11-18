// Shared admin vocabulary.
import { SELECTION } from "@aihot/industry/selection";
import { SOURCE_HEALTH_LABELS } from "@aihot/contracts/site";

export const KIND_LABEL: Record<string, string> = { rss: "RSS", web_list: "网页列表", json_list: "JSON", x_search: "X", mp_account: "公众号", external: "外部上报" };
export const MODE_LABEL: Record<string, string> = { editorial: "精选", hot_signal: "氛围", isolated: "不进新闻" };
export const HEALTH_LABEL: Record<string, string> = SOURCE_HEALTH_LABELS;
export const VISIBILITY_LABEL: Record<string, string> = { public: "公开", "summary-only": "仅摘要", withdrawn: "已下架" };
export const TIER_LABEL: Record<string, string> = { T1: "T1", T1_5: "T1.5", T2: "T2", EXCLUDE_MP: "排除公众号" };
/** The industry pack's source classes, each with the threshold floor it sets. */
export const SELECTION_CLASS_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(SELECTION.classes).map(([k, c]) => [k, `${c.label}（门槛不低于 ${c.threshold}）`]),
);
