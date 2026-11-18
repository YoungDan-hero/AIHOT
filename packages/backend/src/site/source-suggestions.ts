import { createHash } from "node:crypto";
import type { SourceFeedbackRecipient } from "@aihot/contracts/site";
import { beijingStamp } from "@aihot/contracts/time";
import { SITE } from "@aihot/site";
import { config, credential } from "../config.ts";
import { sql } from "../db.ts";
import { enqueue, QUEUES } from "../jobs/queue.ts";
import { sendEmployeeCard } from "../notify/feishu.ts";

export const sourceSuggestionNotificationsEnabled = () =>
  process.env.FEISHU_SOURCE_SUGGESTION_NOTIFY_ENABLED === "true" && process.env.FEISHU_EMPLOYEE_LOGIN_ENABLED === "true";

export function sourceFeedbackRecipient(): SourceFeedbackRecipient | undefined {
  if (!sourceSuggestionNotificationsEnabled()) return;
  const name = credential("integrations", "FEISHU_SOURCE_SUGGESTION_RECIPIENT_NAME")?.trim();
  const openId = credential("integrations", "FEISHU_SOURCE_SUGGESTION_RECIPIENT_OPEN_ID");
  const avatar = URL.parse(credential("integrations", "FEISHU_SOURCE_SUGGESTION_RECIPIENT_AVATAR_URL") ?? "");
  if (!name || !openId || !/^ou_[A-Za-z0-9_-]+$/.test(openId) || avatar?.protocol !== "https:"
    || !avatar.hostname.endsWith(".feishucdn.com") || avatar.username || avatar.password || avatar.port) return;
  const chatUrl = new URL("https://applink.feishu.cn/client/chat/open");
  chatUrl.searchParams.set("openId", openId);
  return { name, avatarUrl: avatar.href, chatUrl: chatUrl.href };
}

export async function saveSourceSuggestion(name: string, url: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    const [created] = await tx<{ id: string }[]>`
      INSERT INTO source_suggestions (name, url) VALUES (${name}, ${url})
      ON CONFLICT (name, url) DO NOTHING RETURNING id`;
    if (!created) return false;
    if (sourceSuggestionNotificationsEnabled()) {
      const job = await enqueue(QUEUES.notifySourceSuggestion, { suggestionId: created.id }, {}, tx);
      if (!job) throw new Error("Could not queue the source suggestion notification");
    }
    return true;
  });
}

export async function notifySourceSuggestion(id: string) {
  const [suggestion] = await sql<{ name: string; url: string; created_at: Date }[]>`
    SELECT name, url, created_at FROM source_suggestions WHERE id = ${id}`;
  if (!suggestion) return { status: "missing" };
  const recipient = credential("integrations", "FEISHU_SOURCE_SUGGESTION_RECIPIENT_UNION_ID");
  if (!recipient || !/^on_[A-Za-z0-9_-]+$/.test(recipient)) throw new Error("Source suggestion Feishu recipient is not configured");
  const plain = (content: string) => ({ tag: "plain_text", content });
  const card = {
    schema: "2.0",
    header: { template: "blue", title: plain(`${SITE.name} · 新信源反馈`) },
    body: { elements: [
      { tag: "div", text: plain(`信源名称：${suggestion.name}`) },
      { tag: "div", text: plain(`信源链接：${suggestion.url}`) },
      { tag: "div", text: plain(`提交时间：${beijingStamp(suggestion.created_at)}`) },
    ] },
  };
  // Feishu deduplicates a resent request with the same UUID for one hour.
  const uuid = createHash("sha256").update(JSON.stringify([config.siteUrl, QUEUES.notifySourceSuggestion, id])).digest("hex").slice(0, 40);
  await sendEmployeeCard(recipient, card, uuid);
  return { status: "sent" };
}
