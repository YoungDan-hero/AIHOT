// Failure modes: startup overwrites the saved choice, malformed/unavailable storage breaks the
// document, denied writes prevent even an in-tab choice, or version-1 backups lose/replace a preference.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { APPEARANCE_BOOT_SCRIPT, exportBundle, getFontPreference, getThemePreference, importBundle, KEYS, resolvedTheme, setFontPreference, setThemePreference } from "../apps/web/app/lib/local-state.ts";

class MemoryStorage {
  values = new Map<string, string>();
  denied = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.denied) throw new Error("full"); this.values.set(key, value); }
  removeItem(key: string) { if (this.denied) throw new Error("full"); this.values.delete(key); }
}
const store = new MemoryStorage();
Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: store, sessionStorage: new MemoryStorage() } });

test("appearance startup applies a saved browser font before rendering and safely handles invalid storage", () => {
  for (const font of ["browser", "bad", null, "denied"]) {
    const attributes: Record<string, string> = {};
    runInNewContext(APPEARANCE_BOOT_SCRIPT, {
      localStorage: { getItem: (key: string) => { if (font === "denied") throw new Error("blocked"); return key === KEYS.font ? font : "dark"; } },
      window: { matchMedia: () => ({ matches: false }) },
      document: { documentElement: { setAttribute: (key: string, value: string) => { attributes[key] = value; } }, querySelector: () => null },
    });
    assert.equal(attributes["data-font"], font === "browser" ? "browser" : "system");
    assert.equal(attributes["data-theme"], font === "denied" ? "light" : "dark");
  }
});

test("first paint defaults to light on a dark system and honors saved themes", () => {
  for (const [saved, systemDark, expected, color] of [
    [null, true, "light", "#faf9f6"],
    ["bad", true, "light", "#faf9f6"],
    ["light", true, "light", "#faf9f6"],
    ["dark", false, "dark", "#13191c"],
    ["auto", false, "light", "#faf9f6"],
    ["auto", true, "dark", "#13191c"],
  ] as const) {
    const attributes: Record<string, string> = {};
    const meta = { content: "#faf9f6" };
    runInNewContext(APPEARANCE_BOOT_SCRIPT, {
      localStorage: { getItem: (key: string) => key === KEYS.theme ? saved : null },
      window: { matchMedia: () => ({ matches: systemDark }) },
      document: { documentElement: { setAttribute: (key: string, value: string) => { attributes[key] = value; } }, querySelector: () => meta },
    });
    assert.equal(attributes["data-theme"], expected);
    assert.equal(meta.content, color);
  }
});

test("an explicitly selected system theme is distinct from the default in storage and backups", () => {
  setThemePreference(null);
  try {
    assert.equal(resolvedTheme(), "light");
    assert.equal(exportBundle().theme, null);
    setThemePreference("auto");
    assert.equal(store.getItem(KEYS.theme), "auto");
    const backup = exportBundle();
    setThemePreference(null);
    assert.equal(importBundle(JSON.stringify(backup)).themeApplied, true);
    assert.equal(getThemePreference(), "auto");
    assert.equal(importBundle(JSON.stringify({ ...backup, theme: "dark" })).themeApplied, false);
  } finally {
    setThemePreference(null);
  }
});

test("font choices survive version-1 backups and denied writes without touching existing reader data", () => {
  setFontPreference("browser");
  assert.equal(getFontPreference(), "browser");
  const backup = exportBundle();
  assert.equal(backup.version, 1);
  assert.equal(backup.font, "browser");
  setFontPreference(null);
  importBundle(JSON.stringify({ version: 1, starred: [], read: [], theme: "auto" }));
  assert.equal(getFontPreference(), null, "old backups remain valid");
  importBundle(JSON.stringify(backup));
  assert.equal(getFontPreference(), "browser");
  importBundle(JSON.stringify({ ...backup, font: "system" }));
  assert.equal(getFontPreference(), "browser", "merging does not overwrite the reader's choice");
  setFontPreference(null);
  store.denied = true;
  setFontPreference("browser");
  assert.equal(getFontPreference(), "browser", "a choice still works in this tab when persistence is blocked");
  setFontPreference(null);
  assert.equal(getFontPreference(), null);
  store.denied = false;
});
