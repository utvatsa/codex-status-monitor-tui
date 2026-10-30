// The pure rules behind the alerts UI of the plain page: window sizes, suggested alert levels, the % <-> tokens helpers, which
// chats and limits need attention, and how snoozing machine alerts works. No DOM and no Preact in here, so `node` can test it
// (tests/test_plain.py). The React page has the same rules in web-ui/src/lib/{settings,attention,snooze}.ts.

// --- window sizes and alert levels -----------------------------------------------------------------------------------

export const SOURCE_TEXT = {
  chat: "set by you for this chat", config: "set by you for this model", evidence: "proven: a turn went past 200k",
  name: "from the model name", default: "built-in default for this model", guess: "a guess: 200k",
};

// The choices of the "Maximum context" menu: [value sent to the server, label].
export const SIZE_OPTIONS = [["200k", "200k"], ["300k", "300k"], ["400k", "400k"], ["500k", "500k"], ["600k", "600k"], ["800k", "800k"],
  ["1m", "1M (recommended)"], ["1.5m", "1.5M"], ["2m", "2M"], ["custom", "Custom…"]];

/** "600k" / "1m" / "1.5m" / "500000" -> tokens, or null when it is not a sensible window (10k to 10M). Same rule as the server. */
export function parseSize(v) {
  const s = String(v).trim().toLowerCase();
  const n = s.endsWith("m") ? parseFloat(s) * 1e6 : s.endsWith("k") ? parseFloat(s) * 1e3 : Number(s);
  return Number.isFinite(n) && n >= 10000 && n <= 10000000 ? Math.round(n) : null;
}

/** A token count typed by hand: "408k", "1.2m" or a plain number. (Smaller than a window, so no 10k floor like parseSize.) */
export function parseTok(v) {
  const t = String(v).trim().toLowerCase();
  const n = t.endsWith("m") ? parseFloat(t) * 1e6 : t.endsWith("k") ? parseFloat(t) * 1e3 : Number(t);
  return t !== "" && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** 600000 -> "600k", 1000000 -> "1m", 408500 -> "408.5k": the shape the command and the inputs use. */
export function sizeText(n) {
  return n >= 1e6 && n % 1e5 === 0 ? `${n / 1e6}m` : `${Math.round(n / 100) / 10}k`;
}

/** The same, for reading: "1M", "408k". */
export const showSize = (n) => sizeText(n).toUpperCase().replace(/K$/, "k");

/**
 * Suggested [amber %, red %] for any window size. Same formula as `suggest_levels` in config.py: anchored on 200k = 85/95 and 1M = 60/90
 * and interpolated on a log scale (a bigger window warns earlier in percent, later in tokens). Red is at least 5 points after amber.
 */
export function suggestLevels(window) {
  const k = Math.min(Math.max(Math.log(Math.max(window, 200000) / 200000) / Math.log(5), 0), 1.6);
  const amber = Math.max(Math.round(85 - 25 * k), 20);
  return [amber, Math.min(Math.max(Math.round(95 - 5 * k), Math.round(85 - 25 * k) + 5), 99)];
}

/** Editing a percentage fills in the tokens ("" when either side is not a number yet). */
export function tokOf(max, pct) {
  const p = Number(pct);
  return max !== null && String(pct).trim() !== "" && Number.isFinite(p) ? sizeText(Math.round(max * p / 100)) : "";
}

/** Editing the tokens fills in the percentage: rounded and kept between 1 and 100 ("" when the tokens are not a number). */
export function pctOf(max, tok) {
  const t = parseTok(tok);
  return t !== null && max ? String(Math.min(100, Math.max(1, Math.round(t / max * 100)))) : "";
}

export const rowFor = (max, pct) => ({ pct: String(pct), tok: tokOf(max, String(pct)) });

/** What is wrong with the editor's values, worded for the user, or null when they can be applied. */
export function problemOf(max, amber, red) {
  const a = Number(amber.pct), r = Number(red.pct);
  const whole = (v) => String(v).trim() !== "" && Number.isInteger(Number(v));
  if (max === null) return "The maximum must be between 10k and 10M, like 600k, 1m or 1.5m.";
  if (!whole(amber.pct) || !whole(red.pct)) return "Amber and red must be whole percentages.";
  if (!(a >= 1 && a < r && r <= 100)) return "Amber must be at least 1% and lower than red, and red at most 100%.";
  if ([amber.tok, red.tok].some((t) => { const n = parseTok(t); return n === null || n > max; })) return `Thresholds must be a token count up to the maximum (${showSize(max)}).`;
  return null;
}

/** The shell command that does the same as the Apply button, for a copy button. */
export const chatCommand = (sid, size, amber, red) =>
  `cust-codex-status --set-window ${sid.slice(0, 8)} ${size}${amber !== undefined && red !== undefined ? ` --levels ${amber} ${red}` : ""}`;

// --- what needs attention: chats and usage limits (machine alerts have their own band) -----------------------------------

export const LIMIT_WARN = 80;       // usage limits from here up are listed (Python's LIMIT_WARN) ...
export const LIMIT_RED = 85;        // ... and from here up they are red

const APP_LINKS = [[/^vs ?code/i, "vscode://", "Open VS Code"], [/^cursor/i, "cursor://", "Open Cursor"], [/^zed/i, "zed://", "Open Zed"]];

/** Only apps that register a URL scheme can be brought forward from a page; a terminal or a JetBrains IDE cannot, so those get no link. */
export function appLink(runningIn) {
  const app = String(runningIn || "").split(" · ")[0].trim();
  const hit = APP_LINKS.find(([re]) => re.test(app));
  return hit ? { href: hit[1], label: hit[2] } : null;
}

function kindOf(x) {
  if (x.waiting) return "waiting";
  const has = (p) => x.why.some((w) => w.startsWith(p));
  return has("context") ? "context" : has("using") ? "memory" : has("busy") ? "stuck" : "idle";
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const RANK = { waiting: 0, context: 1, memory: 2, stuck: 2, limit: 3, idle: 4 };
export const KIND_LABEL = { waiting: "Waiting for you", context: "Context filling up", memory: "Using a lot of memory", stuck: "May be stuck", idle: "Idle", limit: "Usage limit" };

function chatItem(x) {
  const kind = kindOf(x);
  const first = (p) => x.why.find((w) => w.startsWith(p)) || "";
  const headline = kind === "waiting" ? `Waiting for your approval: ${x.waiting}${x.waiting_for ? ` · for ${x.waiting_for}` : ""}`
    : kind === "context" ? `Context ${x.ctx_pct}% of ${x.window} (alerts from ${x.ctx_amber})`
    : kind === "memory" ? cap(first("using"))
    : kind === "stuck" ? cap(first("busy"))
    : cap(first("idle") || "idle");
  return {
    key: x.sid, kind, level: x.health === "RED" ? "RED" : "AMBER", title: x.label, headline, where: x.running_in,
    folder: x.folder === "-" ? null : x.folder, model: x.model, reasons: x.why, tips: x.tips, resume: x.resume || null, pct: x.ctx_pct,
    resets: null, link: appLink(x.running_in), windowText: `${x.window} window · ${SOURCE_TEXT[x.window_source] || ""}`, offer: x.window_offer || null,
  };
}

function limitItem(l) {
  return {
    key: `limit:${l.label}`, kind: "limit", level: l.pct >= LIMIT_RED ? "RED" : "AMBER", title: `${l.label} limit`, headline: `${l.pct}% used`,
    where: null, folder: null, model: null, reasons: [`${l.label} limit at ${l.pct}%, resets in ${l.resets}`],
    tips: ["Slow down or wait for the reset; any new Codex turn refreshes the numbers."], resume: null, pct: l.pct, resets: l.resets, link: null, windowText: null, offer: null,
  };
}

/** Red first, then chats that are blocked on you, then the rest. Machine alerts (snapshot.system) are NOT here. */
export function attentionItems(snap) {
  const chats = snap.sessions.filter((x) => x.active && x.why.length).map(chatItem);
  const limits = snap.usage.limits.filter((l) => l.pct >= LIMIT_WARN).map(limitItem);
  return [...chats, ...limits].sort((a, b) => (a.level === b.level ? 0 : a.level === "RED" ? -1 : 1) || RANK[a.kind] - RANK[b.kind]);
}

// --- snoozing machine alerts ---------------------------------------------------------------------------------------------
// Snoozing only MINIMISES an alert to a chip: it stays on the page while the condition lasts. It opens again by itself if it gets
// worse (AMBER -> RED) and then stays open, even if it later eases back; it is forgotten only when the condition clears.
// The state lives in this browser only: {alert key: the level it had when it was snoozed}.

export const SNOOZE_KEY = "cust-codex-status.snoozed";

export function loadSnoozed(storage) {
  try {
    const raw = JSON.parse(storage.getItem(SNOOZE_KEY) || "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch (e) {
    return {};
  }
}

export function saveSnoozed(storage, s) {
  try { storage.setItem(SNOOZE_KEY, JSON.stringify(s)); } catch (e) { /* private window: it just will not survive a reload */ }
}

/** True while the alert should show as a chip: it was snoozed and has not got worse since. */
export function isMinimised(s, a) {
  const at = s[a.key];
  return !!at && !(at === "AMBER" && a.level === "RED");
}

export const snooze = (s, a) => ({ ...s, [a.key]: a.level });
export const unsnooze = (s, key) => { const { [key]: gone, ...rest } = s; return rest; };

/** Forget snoozes of alerts that are gone (a problem that comes back shows in full) and of alerts that got worse (they stay open). */
export function prune(s, alerts) {
  const now = new Map(alerts.map((a) => [a.key, a.level]));
  const kept = Object.fromEntries(Object.entries(s).filter(([k, at]) => now.has(k) && !(at === "AMBER" && now.get(k) === "RED")));
  return Object.keys(kept).length === Object.keys(s).length ? s : kept;
}
