import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { THEMES, themeFrom, useTheme } from "./useTheme";

describe("themes", () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute("data-theme"); });

  it("offers six themes with distinct swatches and no cyan or slate-blue ones", () => {
    expect(THEMES.map((t) => t.id)).toEqual(["auto", "dark", "light", "sunset", "phosphor", "ink"]);
    expect(new Set(THEMES.map((t) => t.swatch.join())).size).toBe(6);
  });

  it("maps the retired ids to their nearest new theme", () => {
    expect(themeFrom("paper")).toBe("light");
    expect(themeFrom("nord")).toBe("dark");
    expect(themeFrom("dracula")).toBe("sunset");
    expect(themeFrom("phosphor")).toBe("phosphor");
    expect(themeFrom("nope")).toBeNull();
    expect(themeFrom(null)).toBeNull();
  });

  it("starts on Orchid, takes a saved or old id, and the address wins", () => {
    expect(renderHook(() => useTheme()).result.current[0]).toBe("dark");
    localStorage.setItem("cust-codex-status.theme", "dracula");
    expect(renderHook(() => useTheme()).result.current[0]).toBe("sunset");
    expect(renderHook(() => useTheme("ink")).result.current[0]).toBe("ink");
    expect(renderHook(() => useTheme("nord")).result.current[0]).toBe("dark");
  });
});
