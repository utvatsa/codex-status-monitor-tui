// Small pure helpers that turn the snapshot into what the page needs to explain itself: codes, agent totals and
// where chats are running. Kept out of the components so they can be tested and reused.
import type { Session } from "../types";
import type { ThemeId } from "../hooks/useTheme";

/** The short, human-sized form of a session id: its first 8 characters (the same form the work notes and file names use). */
export const sessionCode = (sid: string) => sid.slice(0, 8);

/** An agent's code: its id, as in `<session>/subagents/agent-<code>.jsonl`. The first 7 characters are enough to tell them apart. */
export const agentCode = (code: string) => code.slice(0, 7);

/** A chat that has not answered yet has no model; say so instead of showing a bare dash. */
export const modelLabel = (m: string) => (!m || m === "-" ? "no model yet" : m);

export interface AgentTotals { total: number; running: number; chats: number }

export function agentTotals(sessions: Session[]): AgentTotals {
  let total = 0, running = 0, chats = 0;
  for (const s of sessions) {
    if (!s.subagents.length) continue;
    chats += 1;
    total += s.subagents.length;
    running += s.subagents.filter((a) => a.running).length;
  }
  return { total, running, chats };
}

/** How many of these chats run in each host app (`running_in`) and on each model, most common first. */
export function breakdown(sessions: Session[]): { hosts: [string, number][]; models: [string, number][] } {
  const count = (key: (s: Session) => string) => {
    const m = new Map<string, number>();
    for (const s of sessions) m.set(key(s), (m.get(key(s)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  return { hosts: count((s) => s.running_in), models: count((s) => modelLabel(s.model)) };
}

/** The colour mode a theme belongs to; "auto" follows the system. */
export const modeOf = (t: ThemeId): "light" | "dark" | "auto" =>
  t === "auto" ? "auto" : t === "light" || t === "paper" ? "light" : "dark";

/** What the user sees right now, resolving "auto" through the system setting. */
export function effectiveMode(t: ThemeId): "light" | "dark" {
  const m = modeOf(t);
  if (m !== "auto") return m;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Tick marks and fill colour of a chat's context meter follow ITS alert levels (a 1M window warns earlier than a 200k one). */
export const ctxMarks = (x: { ctx_amber_pct: number; ctx_red_pct: number }): [number, number] => [x.ctx_amber_pct, x.ctx_red_pct];
export const ctxTone = (x: { ctx_pct: number; ctx_amber_pct: number; ctx_red_pct: number }): "good" | "warn" | "bad" =>
  x.ctx_pct >= x.ctx_red_pct ? "bad" : x.ctx_pct >= x.ctx_amber_pct ? "warn" : "good";
