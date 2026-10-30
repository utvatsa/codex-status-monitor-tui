// The theme lives on <html data-theme="…"> so plain CSS can switch every colour token at once (see styles/tokens.css).
import { useEffect, useState } from "react";
import { storage } from "../lib/storage";

export const THEMES = [
  { id: "auto", label: "Auto", hint: "follows your system", swatch: ["#ffffff", "#0e1116"] },
  { id: "light", label: "Light", hint: "crisp and neutral", swatch: ["#ffffff", "#a21caf"] },
  { id: "dark", label: "Dark", hint: "low glare", swatch: ["#161b22", "#e879f9"] },
  { id: "paper", label: "Light · Paper", hint: "warm off-white", swatch: ["#fbf8f2", "#0f766e"] },
  { id: "nord", label: "Dark · Nord", hint: "arctic blue-grey", swatch: ["#3b4252", "#88c0d0"] },
  { id: "dracula", label: "Dark · Dracula", hint: "deep purple", swatch: ["#282a36", "#bd93f9"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);

export function nextTheme(t: ThemeId): ThemeId {
  const i = THEMES.findIndex((x) => x.id === t);
  return THEMES[(i + 1) % THEMES.length].id;
}

export function useTheme(initial?: string | null): [ThemeId, (t: ThemeId) => void] {
  const [theme, setTheme] = useState<ThemeId>(() => {
    if (isTheme(initial)) return initial;
    const saved = storage.get("theme");
    return isTheme(saved) ? saved : "auto";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    storage.set("theme", theme);
  }, [theme]);

  return [theme, setTheme];
}
