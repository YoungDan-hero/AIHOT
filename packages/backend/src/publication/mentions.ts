// A page's payload carries the installed modules' pages its texts name, so it can link them at first mention.
import { mentionedTargets, withoutSharedNames, type MentionTarget } from "@aihot/contracts/mentions";
import { cached, type Cached } from "../lib/cache.ts";
import { serverModules, type ServerModule } from "../modules.ts";

// One dictionary per installed set of modules, read again every few minutes so new pages are linked soon.
const dictionaries = new WeakMap<readonly ServerModule[], Cached<MentionTarget[]>>();

function dictionary(): Promise<MentionTarget[]> {
  const modules = serverModules();
  let d = dictionaries.get(modules);
  if (!d) {
    d = cached(async () => {
      const pages = await Promise.all(modules.map((m) => m.mentions?.() ?? []));
      return withoutSharedNames(pages.flat());
    }, { freshMs: 5 * 60_000, maxStaleMs: 60 * 60_000 });
    dictionaries.set(modules, d);
  }
  return d.get();
}

/** The pages these texts name, in order of first mention. */
export async function mentionsIn(texts: ReadonlyArray<string | null | undefined>): Promise<MentionTarget[]> {
  return mentionedTargets(texts, await dictionary());
}
