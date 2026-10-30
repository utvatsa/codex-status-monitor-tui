// What needs the user, as a list of items the pages can show one at a time: one per live chat with a health reason, and one per
// usage limit near its cap. Built from the same `why` / `tips` / `waiting` fields the TUI uses, so the pages never disagree with it.
import type { Limit, Session, Snapshot, WindowOffer, WindowSource } from "../types";

export type AttentionKind = "waiting" | "context" | "memory" | "stuck" | "idle" | "limit" | "disk";

export interface AppLink { href: string; label: string }

export interface AttentionItem {
  key: string;
  kind: AttentionKind;
  level: "AMBER" | "RED";
  title: string;                 // the chat's name, or the limit's label
  headline: string;              // what it is waiting for / what is wrong, in one line
  where: string | null;          // "IntelliJ · ACP plugin"
  folder: string | null;
  model: string | null;
  reasons: string[];             // every reason, for chats with more than one
  tips: string[];
  resume: string | null;
  pct: number | null;            // context % for a chat, usage % for a limit
  resets: string | null;
  link: AppLink | null;
  windowText: string | null;     // "1.0M window · built-in default for this model", for chats
  offer: WindowOffer | null;     // fix a guessed window: write the setting, or copy the command
}

export const SOURCE_TEXT: Record<WindowSource, string> = {
  chat: "set by you for this chat", config: "set by you for this model", reported: "reported by Codex", evidence: "proven: a turn went past 200k", name: "from the model name", default: "built-in default for this model", guess: "a guess: 200k",
};

/** Usage limits from here up are listed (Python's LIMIT_WARN); from LIMIT_RED up they are red, like the "Busiest limit" tile. */
export const LIMIT_WARN = 80;
export const LIMIT_RED = 85;

// Only apps that register a URL scheme can be brought forward from a page; a terminal, the Codex desktop app or a JetBrains IDE cannot, so those get no link.
const APP_LINKS: [RegExp, AppLink][] = [
  [/^vs ?code/i, { href: "vscode://", label: "Open VS Code" }],
  [/^cursor/i, { href: "cursor://", label: "Open Cursor" }],
  [/^zed/i, { href: "zed://", label: "Open Zed" }],
];

export function appLink(runningIn: string): AppLink | null {
  const app = runningIn.split(" · ")[0].trim();
  return APP_LINKS.find(([re]) => re.test(app))?.[1] ?? null;
}

function kindOf(x: Session): AttentionKind {
  if (x.waiting) return "waiting";
  const has = (p: string) => x.why.some((w) => w.startsWith(p));
  return has("context") ? "context" : has("using") ? "memory" : has("busy") ? "stuck" : "idle";
}

function chatItem(x: Session): AttentionItem {
  const kind = kindOf(x);
  const first = (p: string) => x.why.find((w) => w.startsWith(p)) ?? "";
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const headline = kind === "waiting" ? `Waiting for your approval: ${x.waiting}${x.waiting_for ? ` · for ${x.waiting_for}` : ""}`
    : kind === "context" ? `Context ${x.ctx_pct}% of ${x.window} (alerts from ${x.ctx_amber})`
    : kind === "memory" ? cap(first("using"))
    : kind === "stuck" ? cap(first("busy"))
    : cap(first("idle") || "idle");
  return {
    key: x.sid, kind, level: x.health === "RED" ? "RED" : "AMBER", title: x.label, headline,
    where: x.running_in, folder: x.folder === "-" ? null : x.folder, model: x.model,
    reasons: x.why, tips: x.tips, resume: x.resume || null, pct: x.ctx_pct, resets: null, link: appLink(x.running_in),
    windowText: `${x.window} window · ${SOURCE_TEXT[x.window_source]}`, offer: x.window_offer,
  };
}

function limitItem(l: Limit): AttentionItem {
  return {
    key: `limit:${l.label}`, kind: "limit", level: l.pct >= LIMIT_RED ? "RED" : "AMBER", title: `${l.label} limit`,
    headline: `${l.pct}% used`, where: null, folder: null, model: null,
    reasons: [`${l.label} limit at ${l.pct}%, resets in ${l.resets}`], tips: ["Slow down or wait for the reset; any new Codex turn refreshes the numbers."],
    resume: null, pct: l.pct, resets: l.resets, link: null, windowText: null, offer: null,
  };
}

const RANK: Record<AttentionKind, number> = { waiting: 0, context: 1, memory: 2, stuck: 2, limit: 3, disk: 3, idle: 4 };

/** Red first, then chats that are blocked on you, then the rest. Machine-level alerts (snapshot.system) are NOT here: they have their own band. */
export function attentionItems(s: Snapshot): AttentionItem[] {
  const chats = s.sessions.filter((x) => x.active && x.why.length).map(chatItem);
  const limits = s.usage.limits.filter((l) => l.pct >= LIMIT_WARN).map(limitItem);
  return [...chats, ...limits].sort((a, b) => (a.level === b.level ? 0 : a.level === "RED" ? -1 : 1) || RANK[a.kind] - RANK[b.kind]);
}
