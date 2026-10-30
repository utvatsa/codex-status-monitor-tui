// Agents. Every live chat is one main agent; subagents are extra agents a chat started (Task / Plan / Explore ...). Subagents are not
// processes: each is a transcript (`<session>/subagents/agent-<code>.jsonl`) inside the chat's own process, so they share its pid and are
// told apart by their agent code. One shared helper builds the rows, so every page lists agents the same way.
import type { Session, Subagent, SubPhase } from "../types";

/** An agent's short code: its id, as in `<session>/subagents/agent-<code>.jsonl`. The first 7 characters tell them apart. */
export const agentCode = (code: string) => code.slice(0, 7);

/** A chat's short session code: the first 8 characters of its id (the form the work notes and file names use). */
export const sessionCode = (sid: string) => sid.slice(0, 8);

export interface AgentTotals { main: number; subagents: number; running: number; chats: number }

/** `main` = live chats, `running` = running subagents, `subagents` = all of their subagents, `chats` = live chats that started any. */
export function agentTotals(sessions: Session[]): AgentTotals {
  const live = sessions.filter((x) => x.active);
  const subs = live.flatMap((x) => x.subagents);
  return { main: live.length, subagents: subs.length, running: subs.filter((a) => a.running).length, chats: live.filter((x) => x.subagents.length).length };
}

/** active = working now, waiting = blocked on you, idle = alive but quiet, ended = no process (an archived chat). */
export type AgentState = "active" | "waiting" | "idle" | "ended";

export interface MainAgent {
  sid: string; code: string; pid: number | null; name: string; state: AgentState;
  model: string; ctx: string; ctxPct: number; mem: number | null; last: string; up: string | null;
}

export interface SubAgent {
  full: string; code: string; type: string; desc: string; model: string; ctx: string; turns: number; out: string; ago: string; state: SubPhase;
}

export interface AgentRows { main: MainAgent; subs: SubAgent[]; running: number }

/** The words and the order for subagent states: the ones that need attention first. */
export const PHASES: SubPhase[] = ["active", "idle", "done", "closed"];
export const PHASE_LABEL: Record<SubPhase, string> = { active: "active", idle: "idle", done: "done", closed: "closed" };
export const PHASE_HINT: Record<SubPhase, string> = {
  active: "working now",
  idle: "alive but quiet: waiting or stalled",
  done: "finished its task",
  closed: "was cut off: its chat ended before it finished",
};

export function mainState(s: Session): AgentState {
  return s.waiting ? "waiting" : !s.active ? "ended" : s.state === "busy" ? "active" : "idle";
}

/** An older server sends only `running`: active when running, done otherwise. */
const phaseOf = (a: Subagent): SubPhase => a.phase ?? (a.running ? "active" : "done");

const subRow = (a: Subagent): SubAgent => ({
  full: a.code, code: agentCode(a.code), type: a.type, desc: a.desc, model: a.model, ctx: a.ctx, turns: a.turns ?? 0, out: a.out ?? "0", ago: a.ago,
  state: phaseOf(a),
});

/** The main agent and its subagents as rows: active first, then idle, done, closed; newest first (as the server sent them) within a state. */
export function agentRows(s: Session): AgentRows {
  const subs = s.subagents.map(subRow);
  subs.sort((a, b) => PHASES.indexOf(a.state) - PHASES.indexOf(b.state));                  // stable: keeps newest-first within a state
  return {
    main: { sid: s.sid, code: sessionCode(s.sid), pid: s.pid, name: s.label, state: mainState(s), model: s.model, ctx: s.ctx, ctxPct: s.ctx_pct, mem: s.mem_mb, last: s.last, up: s.up },
    subs, running: subs.filter((a) => a.state === "active").length,
  };
}

/** How many subagents are in each state: for the header of a collapsed list. */
export function subCounts(rows: AgentRows): Record<SubPhase, number> {
  const c: Record<SubPhase, number> = { active: 0, idle: 0, done: 0, closed: 0 };
  for (const a of rows.subs) c[a.state] += 1;
  return c;
}

/** Whether a chat's subagent list starts open: when something is still going on (active or idle) and the list is short. */
export function listStartsOpen(rows: AgentRows): boolean {
  const c = subCounts(rows);
  return rows.subs.length <= 4 && c.active + c.idle > 0;
}

/** The first `n` subagents and how many are left out. */
export function visibleSubs(rows: AgentRows, n: number): { shown: SubAgent[]; hidden: number } {
  return { shown: rows.subs.slice(0, n), hidden: Math.max(0, rows.subs.length - n) };
}

// ---- the Agents view: one card per live chat, with its subagents, filtered by state and by the page's text filter --------------------------

/** Which main section the page shows: the chat cards, or the agent cards (opened from the top Agents tile). */
export type MainView = "chats" | "agents";

export type AgentFilter = "all" | SubPhase;

export interface AgentCard { session: Session; rows: AgentRows; counts: Record<SubPhase, number> }

const MAIN_RANK: Record<AgentState, number> = { active: 0, waiting: 1, idle: 2, ended: 3 };

/** One card per live chat: main agents that are working first, then waiting, then idle (ties keep the order the server sent). */
export function agentCards(sessions: Session[]): AgentCard[] {
  return sessions.filter((x) => x.active).map((session) => {
    const rows = agentRows(session);
    return { session, rows, counts: subCounts(rows) };
  }).sort((a, b) => MAIN_RANK[a.rows.main.state] - MAIN_RANK[b.rows.main.state]);
}

/** How many subagents are in each state over all the cards (for the filter row). */
export function phaseTotals(cards: AgentCard[]): Record<SubPhase, number> {
  const t: Record<SubPhase, number> = { active: 0, idle: 0, done: 0, closed: 0 };
  for (const c of cards) for (const p of PHASES) t[p] += c.counts[p];
  return t;
}

const has = (text: string, q: string) => text.toLowerCase().includes(q);

/**
 * Apply the state filter and the text filter. A state other than "all" keeps only the subagents in that state and drops chats with none.
 * The text matches the chat (name, session id, pid, model) or a subagent (type, description, code): a chat that matches keeps all its
 * subagents, one that only has matching subagents keeps just those. With "all" and no text a chat without subagents is still listed.
 */
export function filterCards(cards: AgentCard[], filter: AgentFilter, query: string): AgentCard[] {
  const q = query.trim().toLowerCase();
  const out: AgentCard[] = [];
  for (const c of cards) {
    const m = c.rows.main;
    const mainHit = !q || has(m.name, q) || has(c.session.sid, q) || has(String(m.pid ?? ""), q) || has(m.model, q);
    let subs = filter === "all" ? c.rows.subs : c.rows.subs.filter((a) => a.state === filter);
    if (q && !mainHit) subs = subs.filter((a) => has(a.type, q) || has(a.desc, q) || has(a.full, q));
    if (!mainHit && !subs.length) continue;
    if (filter !== "all" && !subs.length) continue;
    const rows = { ...c.rows, subs };
    out.push({ session: c.session, rows, counts: subCounts(rows) });
  }
  return out;
}
