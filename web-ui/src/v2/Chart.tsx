// A small live chart in the style of Grafana's stat panels. It starts as a short line and EXPANDS as samples arrive: the
// visible range is [first sample, newest sample] until 15 minutes have been collected, then it scrolls. New data glides in
// (the range end and the value scale are eased with requestAnimationFrame), the newest point pulses, and hovering shows
// a crosshair with the exact value and how long ago it was. The SVG is stretched to its box, so the dot and the tooltip
// are HTML on top of it (a stretched circle would turn into an ellipse).
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { since } from "../lib/format";
import { prefersReducedMotion } from "./hooks";
import { WINDOW_SECS, type Point } from "./series";

const W = 240;

/** Ease a list of numbers toward new targets (ease-out cubic). Jumps straight there with reduced motion. */
export function useEased(targets: number[], ms = 650): number[] {
  const [value, setValue] = useState(targets);
  const cur = useRef(targets);
  const key = targets.join(",");
  useEffect(() => {
    if (prefersReducedMotion() || typeof requestAnimationFrame === "undefined") {
      cur.current = targets;
      setValue(targets);
      return;
    }
    const from = cur.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const next = targets.map((to, i) => (from[i] ?? to) + (to - (from[i] ?? to)) * e);
      cur.current = next;
      setValue(next);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms]);
  return value;
}

/** The series' value at time t (linear between samples, clamped at the ends). */
export function valueAt(points: Point[], t: number): number {
  if (t <= points[0].t) return points[0].v;
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i].t) {
      const a = points[i - 1], b = points[i];
      return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t || 1);
    }
  }
  return points[points.length - 1].v;
}

/** Smooth curve through the points (Catmull-Rom turned into cubic Béziers), y clamped to the box. */
export function smoothPath(p: [number, number][], h: number): string {
  if (p.length < 2) return "";
  const cl = (y: number) => Math.max(0, Math.min(h, y));
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] ?? p2;
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${cl(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${cl(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

export function stepPath(p: [number, number][]): string {
  if (p.length < 2) return "";
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 1; i < p.length; i++) d += ` H${p[i][0].toFixed(1)} V${p[i][1].toFixed(1)}`;
  return d;
}

interface Props {
  points: Point[] | undefined;
  format: (v: number) => string;
  label: string;
  height?: number;
  kind?: "area" | "step";
  min?: number;                       // fixed value-axis bounds (e.g. 0 and 100 for percentages); otherwise they follow the data
  max?: number;
  marks?: number[];                   // dashed reference lines at these values (e.g. 85 and 95)
  color?: string;
  caption?: boolean;                  // show "last 3m" under the chart
}

export function Chart({ points, format, label, height = 38, kind = "area", min, max, marks, color = "var(--accent)", caption }: Props) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const pts = points ?? [];
  const first = pts[0], last = pts[pts.length - 1];

  // value range of what is visible (fixed when min/max are given), padded so the line never touches the edges
  const vals = pts.map((p) => p.v);
  const dataLo = vals.length ? Math.min(...vals) : 0, dataHi = vals.length ? Math.max(...vals) : 1;
  const flat = dataHi - dataLo < 1e-9;
  const tLo = min ?? (flat ? dataLo - Math.max(1, Math.abs(dataLo) * 0.1) : dataLo - (dataHi - dataLo) * 0.15);
  const tHi = max ?? (flat ? dataHi + Math.max(1, Math.abs(dataHi) * 0.1) : dataHi + (dataHi - dataLo) * 0.15);

  const [endT, lo, hi] = useEased([last?.t ?? 0, tLo, tHi]);

  const geo = useMemo(() => {
    if (!first || !last) return null;
    const tStart = Math.max(first.t, endT - WINDOW_SECS);
    const span = Math.max(endT - tStart, 30);                      // never zoom in closer than 30s: a lone point sits at the left
    const x = (t: number) => ((t - tStart) / span) * W;
    const y = (v: number) => height - 3 - ((v - lo) / (hi - lo || 1)) * (height - 6);
    const inside = pts.filter((p) => p.t > tStart && p.t < endT);
    const vis: [number, number][] = [[0, y(valueAt(pts, tStart))], ...inside.map((p) => [x(p.t), y(p.v)] as [number, number]), [x(endT), y(valueAt(pts, endT))]];
    const dedup = vis.filter((p, i) => i === 0 || p[0] - vis[i - 1][0] > 0.2);
    return { tStart, span, x, y, vis: dedup };
  }, [pts, first, last, endT, lo, hi, height]);

  if (!geo || pts.length < 1) return <div className="chart" style={{ height }} aria-label={`${label}: collecting data`}><span className="chart-wait">collecting…</span></div>;

  const line = kind === "step" ? stepPath(geo.vis) : smoothPath(geo.vis, height);
  const tip = hover === null ? null : (() => {
    const t = geo.tStart + (hover / 100) * geo.span;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    return { p: best, left: Math.max(0, Math.min(100, ((best.t - geo.tStart) / geo.span) * 100)), top: (geo.y(best.v) / height) * 100 };
  })();
  const endX = (geo.vis[geo.vis.length - 1][0] / W) * 100, endY = (geo.vis[geo.vis.length - 1][1] / height) * 100;
  const age = (p: Point) => (last.t - p.t < 2 ? "now" : `${since(last.t - p.t)} ago`);

  return (
    <div className="chart-wrap">
      <div className="chart" ref={box} style={{ height, "--c": color } as React.CSSProperties} role="img"
        aria-label={`${label}: now ${format(last.v)}, ${pts.length} samples over ${since(last.t - first.t)}`}
        onPointerMove={(e) => { const r = box.current!.getBoundingClientRect(); setHover(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))); }}
        onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".34" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient>
          </defs>
          {(marks ?? []).map((m) => <line key={m} className="chart-mark" x1="0" x2={W} y1={geo.y(m)} y2={geo.y(m)} />)}
          {line && kind === "area" && <path className="chart-area" d={`${line} L${geo.vis[geo.vis.length - 1][0].toFixed(1)} ${height} L0 ${height} Z`} fill={`url(#${id})`} />}
          {line && <path className="chart-line" d={line} pathLength={1} />}
          {pts.length === 1 && <line className="chart-mark" x1="0" x2={W} y1={geo.y(pts[0].v)} y2={geo.y(pts[0].v)} />}
        </svg>
        <i className="chart-dot" style={{ left: `${endX}%`, top: `${endY}%` }} />
        {tip && (
          <>
            <i className="chart-rule" style={{ left: `${tip.left}%` }} />
            <i className="chart-dot hot" style={{ left: `${tip.left}%`, top: `${tip.top}%` }} />
            <span className="chart-tip" style={{ left: `${tip.left}%`, "--shift": tip.left > 70 ? "-100%" : tip.left < 30 ? "0%" : "-50%" } as React.CSSProperties}>
              <b className="tnum">{format(tip.p.v)}</b> {age(tip.p)}
            </span>
          </>
        )}
      </div>
      {caption && <div className="chart-cap"><span>last {since(last.t - geo.tStart)}</span><span>{pts.length} samples</span></div>}
    </div>
  );
}
