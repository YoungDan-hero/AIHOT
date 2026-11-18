// Modules publish complete public snapshots; page reads never run their collectors.
import { sql } from "../db.ts";

export async function loadModuleSnapshot<T>(name: string): Promise<T | null> {
  const [row] = await sql<{ value: T }[]>`SELECT value FROM settings WHERE key = ${`module.${name}.snapshot`}`;
  return row?.value ?? null;
}
