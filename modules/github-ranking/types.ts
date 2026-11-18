export interface GitHubRankingItem {
  rank: number;
  repo: string;
  url: string;
  description: string;
  descriptionZh: string | null;
  language: string | null;
  stars: number;
  weeklyStars: number;
}

export interface GitHubRankingSnapshot {
  fetchedAt: string;
  sourceUrl: string;
  items: GitHubRankingItem[];
}

export interface GitHubRankingResponse {
  snapshot: GitHubRankingSnapshot | null;
  stale: boolean;
  refreshHours: number;
}
