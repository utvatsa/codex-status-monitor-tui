// The theme lives on <html data-theme="…"> so plain CSS can switch every colour token at once (see styles/tokens.css).
import { useEffect, useState } from "react";
import { storage } from "../lib/storage";

export const THEMES = [
  { id: "auto", label: "Auto", hint: "Orchid or Cream, by your system", swatch: ["#faf5ee", "#0d0a14"] },
  { id: "dark", label: "Orchid", hint: "ink violet, orchid and coral", swatch: ["#0d0a14", "#e879f9", "#ff7a59"] },
  { id: "light", label: "Cream", hint: "warm paper, plum ink", swatch: ["#faf5ee", "#a21caf", "#d9481f"] },
  { id: "sunset", label: "Sunset", hint: "plum night, coral glow", swatch: ["#1a0c18", "#ff7a59", "#ffb36b"] },
  { id: "phosphor", label: "Phosphor", hint: "green on black, amber keys", swatch: ["#050905", "#5cff7a", "#ffc83d"] },
  { id: "ink", label: "Ink & Paper", hint: "monochrome print, high contrast", swatch: ["#f3f1ec", "#0b0b0b", "#a21caf"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

/** Ids from the earlier palettes still found in saved settings or old bookmarks, mapped to their nearest new theme. */
const RETIRED: Record<string, ThemeId> = { paper: "light", nord: "dark", dracula: "sunset" };

/** A theme id from outside (storage, the address) turned into a current id, or null when it is unknown. */
export function themeFrom(v: unknown): ThemeId | null {
  if (isTheme(v)) return v;
  return typeof v === "string" && Object.hasOwn(RETIRED, v) ? RETIRED[v] : null;
}

export const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);

export function nextTheme(t: ThemeId): ThemeId {
  const i = THEMES.findIndex((x) => x.id === t);
  return THEMES[(i + 1) % THEMES.length].id;
}

export function useTheme(initial?: string | null): [ThemeId, (t: ThemeId) => void] {
  const [theme, setTheme] = useState<ThemeId>(() => {
    return themeFrom(initial) ?? themeFrom(storage.get("theme")) ?? "dark";      // a fresh browser starts on Orchid
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    storage.set("theme", theme);
  }, [theme]);

  return [theme, setTheme];
}
