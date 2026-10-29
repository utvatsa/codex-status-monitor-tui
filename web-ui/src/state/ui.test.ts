import { describe, expect, it } from "vitest";
import { effectiveFlags, initialUi, uiReducer, type UiState } from "./ui";

const ids = ["a", "b", "c"];
const at = (cursor: string | null, extra: Partial<UiState> = {}): UiState => ({ ...initialUi, cursor, ...extra });

describe("uiReducer", () => {
  it("moves the cursor and stops at the ends", () => {
    expect(uiReducer(at("a"), { type: "move", delta: 1, ids }).cursor).toBe("b");
    expect(uiReducer(at("c"), { type: "move", delta: 1, ids }).cursor).toBe("c");
    expect(uiReducer(at("a"), { type: "move", delta: -1, ids }).cursor).toBe("a");
  });

  it("puts a missing cursor on the first chat instead of skipping it", () => {
    expect(uiReducer(at(null), { type: "move", delta: 1, ids }).cursor).toBe("a");
  });

  it("NAVIGATE -> SELECTED -> back, then back clears the filter", () => {
    let s = uiReducer(at("b", { query: "x" }), { type: "select" });
    expect(s.selected).toBe(true);
    s = uiReducer(s, { type: "back" });
    expect([s.selected, s.query]).toEqual([false, "x"]);
    s = uiReducer(s, { type: "back" });
    expect(s.query).toBe("");
  });

  it("a click picks and selects", () => {
    expect(uiReducer(at("a"), { type: "pick", id: "c" })).toMatchObject({ cursor: "c", selected: true });
  });

  it("keeps the cursor on the same chat when the list changes, and resets it when that chat is gone", () => {
    expect(uiReducer(at("b", { selected: true }), { type: "sync", ids: ["x", "b"] })).toMatchObject({ cursor: "b", selected: true });
    expect(uiReducer(at("b", { selected: true }), { type: "sync", ids: ["x", "y"] })).toMatchObject({ cursor: "x", selected: false });
    expect(uiReducer(at("b"), { type: "sync", ids: [] }).cursor).toBeNull();
  });

  it("a level change drops the toggles; a toggle flips one flag of the current level", () => {
    let s = uiReducer(initialUi, { type: "toggleFlag", flag: "showArc", current: false });
    expect(effectiveFlags(s, 75).showArc).toBe(true);
    s = uiReducer(s, { type: "setLevel", level: 60 });
    expect(s.overrides).toEqual({});
    expect(effectiveFlags(s, 75)).toMatchObject({ level: 60, lean: true, showArc: false });
  });

  it("uses the CLI's level until the user picks one", () => {
    expect(effectiveFlags(initialUi, 95)).toMatchObject({ level: 95, showArc: true });
  });

  it("expand all, then collapse all", () => {
    let s = uiReducer(initialUi, { type: "expandAll", ids });
    expect(Object.keys(s.expanded)).toEqual(ids);
    s = uiReducer(s, { type: "expandAll", ids });
    expect(s.expanded).toEqual({});
  });
});
