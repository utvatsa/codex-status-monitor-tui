// Everything the user can change on the page (not the data: that comes from the server) lives in one object,
// changed only by `uiReducer`. Keys, clicks and the toolbar all dispatch the same actions, so they cannot drift apart,
// and the rules can be unit-tested without rendering anything.
import { clampLevel, flagsFor, stepLevel, type FlagName, type Flags } from "../lib/view";

export interface UiState {
  level: number | null;                 // null: use the level the CLI was started with (snapshot.view.level)
  overrides: Partial<Flags>;            // toggles that flip one flag of the current level until the level changes
  arcPrompt: boolean;                   // archived rows show their latest prompt
  allSubagents: boolean;                // every subagent, not just the latest 3
  showAccount: boolean;
  cursor: string | null;                // session id under the highlight (selection follows ids, never positions)
  selected: boolean;                    // NAVIGATE (false) or SELECTED (true), like the TUI
  query: string;
  expanded: Record<string, true>;       // rows opened with their chevron
  helpOpen: boolean;
}

export const initialUi: UiState = {
  level: null,
  overrides: {},
  arcPrompt: true,
  allSubagents: false,
  showAccount: false,
  cursor: null,
  selected: false,
  query: "",
  expanded: {},
  helpOpen: false,
};

export type UiAction =
  | { type: "setLevel"; level: number }
  | { type: "stepLevel"; delta: number; current: number }
  | { type: "toggleFlag"; flag: FlagName; current: boolean }
  | { type: "toggle"; key: "arcPrompt" | "allSubagents" | "showAccount" | "helpOpen" }
  | { type: "move"; delta: number; ids: string[] }
  | { type: "jump"; to: "first" | "last"; ids: string[] }
  | { type: "pick"; id: string }
  | { type: "select" }
  | { type: "back" }
  | { type: "setQuery"; query: string }
  | { type: "toggleExpanded"; id: string }
  | { type: "expandAll"; ids: string[] }
  | { type: "closeHelp" }
  | { type: "sync"; ids: string[] };

export function uiReducer(s: UiState, a: UiAction): UiState {
  switch (a.type) {
    case "setLevel":
      return { ...s, level: clampLevel(a.level), overrides: {} };
    case "stepLevel":
      return { ...s, level: stepLevel(a.current, a.delta), overrides: {} };
    case "toggleFlag":
      return { ...s, overrides: { ...s.overrides, [a.flag]: !a.current } };
    case "toggle":
      return { ...s, [a.key]: !s[a.key] };
    case "move": {
      if (!a.ids.length) return s;
      const i = s.cursor ? a.ids.indexOf(s.cursor) : -1;
      const j = Math.max(0, Math.min(a.ids.length - 1, (i < 0 ? 0 : i) + (i < 0 ? 0 : a.delta)));
      return { ...s, cursor: a.ids[j] };
    }
    case "jump":
      return a.ids.length ? { ...s, cursor: a.to === "first" ? a.ids[0] : a.ids[a.ids.length - 1] } : s;
    case "pick":
      return { ...s, cursor: a.id, selected: true };
    case "select":
      return s.cursor ? { ...s, selected: true } : s;
    case "back":
      if (s.selected) return { ...s, selected: false };
      if (s.query) return { ...s, query: "" };
      return s;
    case "setQuery":
      return { ...s, query: a.query };
    case "toggleExpanded": {
      const expanded = { ...s.expanded };
      if (expanded[a.id]) delete expanded[a.id];
      else expanded[a.id] = true;
      return { ...s, expanded };
    }
    case "expandAll":
      return { ...s, expanded: Object.keys(s.expanded).length ? {} : Object.fromEntries(a.ids.map((id) => [id, true] as const)) };
    case "closeHelp":
      return { ...s, helpOpen: false };
    case "sync":
      // The list changed (refresh, filter, archived on/off): keep the cursor on a chat that still exists.
      if (!a.ids.length) return s.cursor === null ? s : { ...s, cursor: null, selected: false };
      if (s.cursor && a.ids.includes(s.cursor)) return s;
      return { ...s, cursor: a.ids[0], selected: false };
  }
}

/** The flags actually in effect: the level's baseline, then the toggles on top. */
export function effectiveFlags(s: UiState, serverLevel: number): Flags & { level: number } {
  const level = s.level ?? serverLevel;
  return { ...flagsFor(level), ...s.overrides, level };
}
