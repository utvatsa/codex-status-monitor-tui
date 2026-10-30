// What the six headline tiles show, derived once so both designs say the same thing.
// The numbers come from `totals.metrics` (src/cust_codex_status/metrics.py); an older server without it falls back to what the sessions give.
import { agentTotals } from "./agents";
import { compact } from "./format";
import type { CodexMetrics, Limit, Session, Snapshot } from "../types";

export type Level = "good" | "warn" | "bad";

const EMPTY: CodexMetrics = {
  threads: 0, turns: 0, tokens: 0, cache_pct: null, cached: 0, fresh_input: 0, reasoning_pct: null, reasoning: 0, output: 0,
  tokens_per_turn: null, headroom_pct: null, headroom_chat: null, approval: [], effort: [],
};

export const metricsOf = (s: Snapshot): CodexMetrics => ({ ...EMPTY, ...(s.totals.metrics ?? { threads: s.totals.live }) });

/** The live thread with the least context left (what the headroom tile is about). */
export function tightest(sessions: Session[]): Session | null {
  const live = sessions.filter((x) => x.active);
  return live.length ? live.reduce((a, b) => (b.ctx_pct > a.ctx_pct ? b : a)) : null;
}

/** Remaining context of the tightest live thread, in percent. */
export const headroomOf = (sessions: Session[]): number | null => {
  const t = tightest(sessions);
  return t ? Math.max(0, 100 - t.ctx_pct) : null;
};

/** Headroom is judged against the thread's own alert levels (a 1M window warns earlier than a 200k one). */
export function headroomLevel(sessions: Session[]): Level {
  const t = tightest(sessions);
  return !t ? "good" : t.ctx_pct >= t.ctx_red_pct ? "bad" : t.ctx_pct >= t.ctx_amber_pct ? "warn" : "good";
}

export const busiestLimit = (limits: Limit[]): Limit | undefined => [...limits].sort((a, b) => b.pct - a.pct)[0];

export const limitLevel = (pct: number): Level => (pct >= 85 ? "bad" : pct >= 60 ? "warn" : "good");

/** "medium 3 · high 1" */
export const mixText = (pairs: [string, number][]): string => pairs.map(([k, n]) => `${k} ${n}`).join(" · ");

export interface TileFacts {
  m: CodexMetrics;
  subagents: { total: number; running: number };
  headroom: number | null;
  headroomChat: string | null;
  headroomLevel: Level;
  limit: Limit | undefined;
  cacheText: string;
  reasoningText: string;
}

export function tileFacts(s: Snapshot): TileFacts {
  const m = metricsOf(s);
  const a = agentTotals(s.sessions.filter((x) => x.active));
  const t = tightest(s.sessions);
  return {
    m, subagents: { total: a.subagents, running: a.running },
    headroom: m.headroom_pct ?? headroomOf(s.sessions),
    headroomChat: m.headroom_chat ?? (t ? t.name ?? t.title : null),
    headroomLevel: headroomLevel(s.sessions),
    limit: busiestLimit(s.usage.limits),
    cacheText: m.cache_pct === null ? "no input yet" : `${compact(m.cached)} cached of ${compact(m.cached + m.fresh_input)} input`,
    reasoningText: m.reasoning_pct === null ? "no output yet" : `${compact(m.reasoning)} of ${compact(m.output)} output`,
  };
}
