// The data contract with Python: these types mirror `snapshot()` in src/cust_codex_status/web/bridge.py.
// If you add a field there, add it here too; TypeScript then shows every place that should use it.

export type Health = "OK" | "AMBER" | "RED";

/** A subagent's state. Older servers send only `running`, so the helper in lib/agents.ts falls back to active / done. */
export type SubPhase = "active" | "idle" | "done" | "closed";

export interface Subagent {
  code: string;                  // the agent's id: the file is <session>/subagents/agent-<code>.jsonl
  type: string;
  desc: string;
  model: string;
  ctx: string;
  ago: string;
  turns: number;                 // assistant turns so far
  out: string;                   // output tokens so far, "4.1k"
  phase: SubPhase;               // active (writing now) | idle (alive, quiet) | done (finished) | closed (its chat ended first)
  running: boolean;              // phase === "active"
}

export type WindowSource = "chat" | "config" | "reported" | "evidence" | "name" | "default" | "guess";    // chat = set by the user for this chat

/** Offered when the window is only a guess and the chat is nearly full on it: the page can set it for THIS chat, or the user can run `command`. */
export interface WindowOffer { sid: string; size: string; amber: number; red: number; command: string }

export interface Advice { kind: "delete-scratch" | "archive" | "long-transcript"; text: string; command: string | null }

/** A machine-level problem: all live chats against RAM, or free disk. */
export interface SystemAlert {
  key: string; kind: "memory" | "disk"; level: "AMBER" | "RED"; title: string; headline: string; tips: string[];
  culprits: { sid: string; label: string; mem_mb: number }[];   // memory: the biggest live chats, biggest first
  reclaim_mb?: number;           // disk: what ended chats' scratch files could free
  reclaim_chats?: string[];      // disk: the sids of those chats
}

/** Codex headline numbers over the live chats (src/cust_codex_status/metrics.py); null when there is nothing to base them on. */
export interface CodexMetrics {
  threads: number; turns: number; tokens: number;
  cache_pct: number | null; cached: number; fresh_input: number;      // cached / (uncached + cached) input
  reasoning_pct: number | null; reasoning: number; output: number;    // reasoning / output tokens
  tokens_per_turn: number | null;
  headroom_pct: number | null; headroom_chat: string | null;          // the tightest live chat's remaining context
  approval: [string, number][]; effort: [string, number][];            // live chats per approval policy / reasoning effort
}

export interface Session {
  sid: string;
  active: boolean;
  name: string | null;
  title: string;
  label: string;
  state: string;                 // idle | busy | running? | ended
  waiting: string | null;        // what a live chat is waiting on (a permission prompt), if anything
  health: Health;
  why: string[];                 // reasons for the health level, already worded
  tips: string[];
  model: string;
  ctx_pct: number;
  ctx: string;                   // "152.8k"
  window: string;                // "200.0k"
  maybe_1m: boolean;             // nearly full on a window that is only a guess: it may really be 1M
  window_tokens: number;
  window_source: WindowSource;   // where the window came from; "guess" is the only one worth questioning
  ctx_amber_pct: number;         // alert levels for THIS chat's window (a 1M window warns earlier than a 200k one)
  ctx_red_pct: number;
  ctx_amber: string;             // the same levels in tokens, "600.0k"
  ctx_red: string;
  window_offer: WindowOffer | null;
  levels_custom: boolean;        // the user also chose this chat's alert levels
  clear_command: string;         // `cust-codex-status --clear-window <chat>`: back to automatic
  waiting_for: string | null;    // how long it has been waiting on the user, "14m", once that is 2 minutes or more
  files: { total_mb: number; parts: [string, number][] } | null;    // what the chat leaves on disk, biggest part first
  advice: Advice[];              // archive / delete suggestions (commands are shown, never run)
  turns: number;
  out: string;
  inp: string;                   // uncached input tokens ("12.0k"); Codex counts cached tokens inside input, the bridge splits them
  cache_r: string;               // cached input tokens
  reasoning: string;             // reasoning output tokens (already part of `out`)
  tokens: string;                // input + cached + output, "43.0k"
  cost: string;                  // always "-": Codex has no price table
  branch: string | null;         // git branch from the Codex state db
  approval: string | null;       // approval policy (never | on-request | untrusted ...)
  entry: string | null;          // cli | exec | desktop | vscode | acp | appserver
  mem_mb: number | null;
  pid: number | null;
  folder: string;
  running_in: string;            // "IntelliJ · ACP plugin"
  source: string;
  last: string;                  // "4m"
  up: string | null;
  first_prompt: string | null;
  latest_prompt: string | null;
  resume: string;
  clean: string;
  subagents: Subagent[];
}

export interface Limit {
  label: string;
  pct: number;
  resets: string;
  binding: boolean;
}

export interface Snapshot {
  generated: number;             // unix seconds
  clock: string;
  source: "tui" | "headless";
  account: { email: string | null; plan: string | null; tier: string | null; fields: [string, string][] };
  usage: { limits: Limit[]; pools: string[]; cached_ago: string | null; stale: boolean };
  warnings: string[];
  system: SystemAlert[];
  totals: { metrics: CodexMetrics; live: number; mem_mb: number; live_cost: number; live_tokens: number; archived: number; arc_cost: number; arc_tokens: number; health: Record<Health, number> };
  sessions: Session[];
  view: {
    level: number;
    levels: [number, string][];
    reps: number[];
    show_live: boolean;
    has_arc: boolean;
    days: number;
    project: string | null;
    hidden: number;
    ctx_amber: number;
    ctx_red: number;
    ctx_rules: Record<"200k" | "1m", [number, number]>;   // [amber %, red %] by window class
  };
}

export type Connection = "connecting" | "live" | "retrying" | "stopped";
