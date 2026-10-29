// Live history for the charts. The server only ever sends the latest snapshot, so the page builds the time series itself:
// every new snapshot adds one point to each series (headline numbers, plus context and memory for every live chat).
// The last 15 minutes are kept in memory and mirrored to sessionStorage, so a reload does not start the charts empty.
import { useEffect, useReducer, useRef } from "react";
import type { Snapshot } from "../types";

export interface Point { t: number; v: number }
export type SeriesMap = Record<string, Point[]>;

export const WINDOW_SECS = 15 * 60;
const MAX_POINTS = 360;
const KEY = "cust-codex-status.v2.series";

function load(): SeriesMap {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) || "{}") as SeriesMap;
    return typeof raw === "object" && raw ? raw : {};
  } catch {
    return {};
  }
}

/** Add a point to a series (replacing one with the same timestamp) and drop what fell out of the window or the cap. */
export function pushPoint(map: SeriesMap, key: string, t: number, v: number): void {
  const list = (map[key] ??= []);
  if (list.length && list[list.length - 1].t === t) list[list.length - 1] = { t, v };
  else list.push({ t, v });
  const cutoff = t - WINDOW_SECS - 30;
  while (list.length > 2 && list[0].t < cutoff) list.shift();
  if (list.length > MAX_POINTS) list.splice(0, list.length - MAX_POINTS);
}

/** Turn one snapshot into points on every series; series of chats that are no longer live are dropped. */
export function record(prev: SeriesMap, s: Snapshot): SeriesMap {
  const next: SeriesMap = {};
  for (const [k, v] of Object.entries(prev)) next[k] = v.slice();
  const t = s.generated;
  const live = s.sessions.filter((x) => x.active);
  pushPoint(next, "mem", t, s.totals.mem_mb);
  pushPoint(next, "tokens", t, s.totals.live_tokens);
  pushPoint(next, "limit", t, s.usage.limits.reduce((m, l) => Math.max(m, l.pct), 0));
  const keep = new Set(["mem", "tokens", "limit"]);
  for (const x of live) {
    pushPoint(next, `ctx:${x.sid}`, t, x.ctx_pct);
    pushPoint(next, `mem:${x.sid}`, t, x.mem_mb ?? 0);
    keep.add(`ctx:${x.sid}`);
    keep.add(`mem:${x.sid}`);
  }
  for (const k of Object.keys(next)) if (!keep.has(k)) delete next[k];
  return next;
}

export function useSeries(snapshot: Snapshot | null): SeriesMap {
  const ref = useRef<SeriesMap>(load());
  const last = useRef(0);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!snapshot || snapshot.generated === last.current) return;
    last.current = snapshot.generated;
    ref.current = record(ref.current, snapshot);
    try { sessionStorage.setItem(KEY, JSON.stringify(ref.current)); } catch { /* storage blocked: charts just restart on reload */ }
    bump();
  }, [snapshot]);
  return ref.current;
}
