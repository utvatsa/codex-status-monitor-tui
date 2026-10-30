// The one thing a page may change: ONE chat's context window and alert levels, through POST /api/config. The tool's own settings
// and Codex's data are never touched from the page. Every caller also shows the equivalent command, so a refused or failed
// write is never a dead end.
export interface SettingResult { ok: boolean; error?: string }

async function post(body: unknown): Promise<SettingResult> {
  try {
    const r = await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) return { ok: true };
    const d = await r.json().catch(() => ({}));
    return { ok: false, error: (d as { error?: string }).error ?? `the server said ${r.status}` };
  } catch {
    return { ok: false, error: "the server is not reachable" };
  }
}

/** Set this chat's window ("600k", "1m" or a token count) and, optionally, its amber and red levels (% of the window). */
export const setChat = (sid: string, window: string, amber?: number, red?: number) =>
  post({ chat: { sid, window, ...(amber !== undefined && red !== undefined ? { amber, red } : {}) } });

/** Back to automatic for this chat. */
export const clearChat = (sid: string) => post({ chat: { sid, clear: true } });

/** "600k" / "1m" / "1.5m" / "500000" -> tokens, or null when it is not a sensible window (10k to 10M). Same rule as the server. */
export function parseSize(v: string | number): number | null {
  const s = String(v).trim().toLowerCase();
  const n = s.endsWith("m") ? parseFloat(s) * 1e6 : s.endsWith("k") ? parseFloat(s) * 1e3 : Number(s);
  return Number.isFinite(n) && n >= 10_000 && n <= 10_000_000 ? Math.round(n) : null;
}

/**
 * Suggested [amber %, red %] for any window size. Same formula as `suggest_levels` in config.py: anchored on 200k = 85/95 and 1M = 60/90 and
 * interpolated on a log scale (a bigger window warns earlier in percent, later in tokens). Red is at least 5 points after amber.
 */
export function suggestLevels(window: number): [number, number] {
  const k = Math.min(Math.max(Math.log(Math.max(window, 200_000) / 200_000) / Math.log(5), 0), 1.6);
  const amber = Math.max(Math.round(85 - 25 * k), 20);
  return [amber, Math.min(Math.max(Math.round(95 - 5 * k), Math.round(85 - 25 * k) + 5), 99)];
}

/** The shell command that does the same as setChat, for a copy button. */
export const chatCommand = (sid: string, size: string, amber?: number, red?: number) =>
  `cust-codex-status --set-window ${sid.slice(0, 8)} ${size}${amber !== undefined && red !== undefined ? ` --levels ${amber} ${red}` : ""}`;
