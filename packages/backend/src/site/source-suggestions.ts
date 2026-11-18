import { sql } from "../db.ts";

export async function saveSourceSuggestion(name: string, url: string): Promise<boolean> {
  const [created] = await sql<{ id: string }[]>`
    INSERT INTO source_suggestions (name, url) VALUES (${name}, ${url})
    ON CONFLICT (name, url) DO NOTHING RETURNING id`;
  return Boolean(created?.id);
}
