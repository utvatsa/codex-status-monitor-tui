// A small, realistic snapshot (the shape bridge.py sends) for component tests.
import type { Session, Snapshot, SystemAlert } from "../types";

export function session(over: Partial<Session> = {}): Session {
  return {
    sid: "11111111-aaaa", active: true, name: "demo-chat", title: "Fix the thing", label: "demo-chat", state: "idle", waiting: null,
    health: "OK", why: [], tips: [], model: "opus-5-5", ctx_pct: 20, ctx: "40.0k", window: "200.0k", maybe_1m: false,
    window_tokens: 200_000, window_source: "guess", ctx_amber_pct: 85, ctx_red_pct: 95, ctx_amber: "170.0k", ctx_red: "190.0k", window_offer: null, levels_custom: false, clear_command: "cust-codex-status --clear-window 11111111",
    waiting_for: null, files: { total_mb: 12.5, parts: [["transcript", 9.3], ["temp", 3.2]] }, advice: [],
    turns: 3, out: "1.2k", inp: "4.0k", cache_r: "30.0k", reasoning: "300", tokens: "35.2k", cost: "-", branch: "main", approval: "on-request", entry: "cli", mem_mb: 100, pid: 123, folder: "~/proj", running_in: "terminal · CLI",
    source: "terminal", last: "2m", up: "01:00", first_prompt: "first prompt text", latest_prompt: "latest prompt text",
    resume: "cd ~/proj && codex resume 11111111-aaaa", clean: "cd ~/proj && codex", subagents: [], ...over,
  };
}

export function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  const sessions = [
    session(),
    session({ sid: "22222222-bbbb", name: "busy-chat", label: "busy-chat", title: "Big refactor", state: "busy", health: "AMBER",
      why: ["context 89% full"], tips: ["context ~89% full: /compact"], ctx_pct: 89, maybe_1m: true,
      resume: "cd ~/big && codex resume 22222222-bbbb" }),
    session({ sid: "33333333-cccc", active: false, name: null, label: "Old chat", title: "Old chat", state: "ended", pid: null,
      mem_mb: null, up: null, resume: "cd ~ && codex resume 33333333-cccc" }),
  ];
  return {
    generated: Date.now() / 1000, clock: "Sun 25 Oct 2026 10:00:00", source: "tui",
    account: { email: "test@example.com", plan: "pro", tier: "tier_x", fields: [["plan", "pro"]] },
    usage: { limits: [{ label: "5-hour session", pct: 42, resets: "2.0h", binding: true }], pools: [], cached_ago: "1m", stale: false },
    warnings: ["busy-chat (terminal · CLI): context 89% full"], system: [],
    totals: { metrics: { threads: 2, turns: 6, tokens: 70400, cache_pct: 87, cached: 60000, fresh_input: 8000, reasoning_pct: 25, reasoning: 600, output: 2400, tokens_per_turn: 11733, headroom_pct: 11, headroom_chat: "busy-chat", approval: [["on-request", 2]], effort: [["medium", 1], ["high", 1]] }, live: 2, mem_mb: 200, live_cost: 0, live_tokens: 70400, archived: 1, arc_cost: 0, arc_tokens: 35200, health: { OK: 1, AMBER: 1, RED: 0 } },
    sessions,
    view: { level: 75, levels: [], reps: [10, 30, 60, 75, 95], show_live: true, has_arc: true, days: 7, project: null, hidden: 0, ctx_amber: 85, ctx_red: 95, ctx_rules: { "200k": [85, 95], "1m": [60, 90] } },
    ...over,
  };
}

export function memoryAlert(over: Partial<SystemAlert> = {}): SystemAlert {
  return {
    key: "system:memory", kind: "memory", level: "AMBER", title: "Memory is tight", headline: "Chats hold 11.2 GB of 16 GB", tips: ["Close the chats you no longer need."],
    culprits: [{ sid: "22222222-bbbb", label: "busy-chat", mem_mb: 4200 }, { sid: "11111111-aaaa", label: "demo-chat", mem_mb: 900 }], ...over,
  };
}

export function diskAlert(over: Partial<SystemAlert> = {}): SystemAlert {
  return {
    key: "system:disk", kind: "disk", level: "AMBER", title: "Disk is filling up", headline: "6 GB free", tips: ["Delete scratch files of ended chats."],
    culprits: [], reclaim_mb: 1840, reclaim_chats: ["33333333-cccc", "44444444-dddd"], ...over,
  };
}
