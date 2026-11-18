import { load } from "cheerio";
import type { GitHubRankingItem } from "../types.ts";

export const TRENDING_URL = "https://github.com/trending?since=weekly";

export const cleanText = (text: string): string => text.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();

/** Only a public GitHub repository path, without credentials, ports, queries or encoded separators. */
export function repositoryFromHref(href: string): string | null {
  const path = href.startsWith("https://github.com/") ? href.slice("https://github.com".length) : href;
  const match = /^\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9_.-]{1,100})$/.exec(path);
  if (!match || [".", ".."].includes(match[2])) return null;
  return `${match[1]}/${match[2]}`;
}

function starCount(text: string): number {
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(text)) throw new Error("GitHub Trending star count is invalid");
  const value = Number(text.replaceAll(",", ""));
  if (!Number.isSafeInteger(value)) throw new Error("GitHub Trending star count is out of range");
  return value;
}

export function rankRepositories(items: GitHubRankingItem[]): GitHubRankingItem[] {
  return items.sort((a, b) => b.weeklyStars - a.weeklyStars || b.stars - a.stars
    || (a.repo.toLowerCase() < b.repo.toLowerCase() ? -1 : a.repo.toLowerCase() > b.repo.toLowerCase() ? 1 : 0))
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export function parseTrending(html: string): GitHubRankingItem[] {
  const $ = load(html);
  const rows = $("article.Box-row");
  if (!rows.length) throw new Error("GitHub Trending repository list is empty or its structure changed");
  const items = new Map<string, GitHubRankingItem>();
  for (const row of rows) {
    const article = $(row);
    const repo = repositoryFromHref(article.find("h2 a").first().attr("href") ?? "");
    if (!repo) continue;
    const weekly = /^([\d,]+) stars? this week$/.exec(cleanText(article.find(".float-sm-right").text()));
    if (!weekly) throw new Error("GitHub Trending weekly stars are missing or its structure changed");
    const stars = starCount(cleanText(article.find(`a[href="/${repo}/stargazers"], a[href="https://github.com/${repo}/stargazers"]`).first().text()));
    const item: GitHubRankingItem = {
      rank: 0, repo, url: `https://github.com/${repo}`,
      description: cleanText(article.find("p").first().text()).slice(0, 2000), descriptionZh: null,
      language: cleanText(article.find('[itemprop="programmingLanguage"]').first().text()).slice(0, 100) || null,
      stars, weeklyStars: starCount(weekly[1]),
    };
    const key = repo.toLowerCase();
    const previous = items.get(key);
    if (!previous || item.weeklyStars > previous.weeklyStars || item.weeklyStars === previous.weeklyStars && item.stars > previous.stars) items.set(key, item);
  }
  if (!items.size) throw new Error("GitHub Trending contains no valid repositories");
  return rankRepositories([...items.values()]);
}
