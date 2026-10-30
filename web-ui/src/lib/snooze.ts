// Snoozing a machine-level alert (RAM, disk) only MINIMISES it: it stays on the page as a small chip for as long as the condition lasts.
// It opens again by itself if the alert gets worse (AMBER -> RED) and then stays open, even if it later eases back to AMBER; it is
// forgotten only when the condition clears. The state lives in this browser only (localStorage), never in the tool's config or on the server.
import type { SystemAlert } from "../types";

export type Snoozed = Record<string, "AMBER" | "RED">;     // alert key -> the level it had when it was snoozed

const KEY = "cust-codex-status.snoozed";

export function loadSnoozed(): Snoozed {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return raw && typeof raw === "object" ? (raw as Snoozed) : {};
  } catch {
    return {};
  }
}

export function saveSnoozed(s: Snoozed): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window: it just will not survive a reload */ }
}

/** True while the alert should show as a chip: it was snoozed and has not got worse since. */
export function isMinimised(s: Snoozed, a: SystemAlert): boolean {
  const at = s[a.key];
  return !!at && !(at === "AMBER" && a.level === "RED");
}

export const snooze = (s: Snoozed, a: SystemAlert): Snoozed => ({ ...s, [a.key]: a.level });
export const unsnooze = (s: Snoozed, key: string): Snoozed => { const { [key]: _gone, ...rest } = s; return rest; };

/** Forget snoozes for alerts that are gone (so a problem that comes back is shown in full) and for alerts that got worse (so they stay open). */
export function prune(s: Snoozed, alerts: SystemAlert[]): Snoozed {
  const now = new Map(alerts.map((a) => [a.key, a.level]));
  const kept = Object.fromEntries(Object.entries(s).filter(([k, at]) => now.has(k) && !(at === "AMBER" && now.get(k) === "RED"))) as Snoozed;
  return Object.keys(kept).length === Object.keys(s).length ? s : kept;
}
