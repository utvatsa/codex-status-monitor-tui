// Small display helpers. Most numbers arrive already formatted from Python; these only cover what changes
// between snapshots in the browser (the "updated 3s ago" clock) and colour choices.

export function since(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

/** Fill colour of a meter: the same thresholds as util.bar in Python (<60 green, <85 amber, else red). */
export type Tone = "good" | "warn" | "bad";

export function tone(pct: number): Tone {
  return pct >= 85 ? "bad" : pct >= 60 ? "warn" : "good";
}

/** Token counts like Python's util.fmt: 950, 12.3k, 1.2M. */
export function compact(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n));
}

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
