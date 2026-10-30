// Per-browser preferences (theme, level, archived prompt line). Storage can be missing or throw (private windows,
// blocked site data), so every access is wrapped and the page works the same without it.
const PREFIX = "cust-codex-status.";

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(PREFIX + key, value);
    } catch {
      /* not kept: fine */
    }
  },
};
