// Tests for the live charts: the pure pieces (series bookkeeping, interpolation, path building) and the component.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";
import { Chart, smoothPath, stepPath, valueAt } from "./Chart";
import { pushPoint, record, WINDOW_SECS, type SeriesMap } from "./series";
import { session, snapshot } from "../test/fixtures";
import { FakeEventSource } from "../test/setup";

describe("series", () => {
  it("adds one point per snapshot and replaces a repeat of the same timestamp", () => {
    const m: SeriesMap = {};
    pushPoint(m, "mem", 100, 5); pushPoint(m, "mem", 105, 6); pushPoint(m, "mem", 105, 7);
    expect(m.mem).toEqual([{ t: 100, v: 5 }, { t: 105, v: 7 }]);
  });

  it("forgets points older than the 15 minute window", () => {
    const m: SeriesMap = {};
    for (let t = 0; t <= WINDOW_SECS + 200; t += 60) pushPoint(m, "x", t, 1);
    expect(m.x[0].t).toBeGreaterThanOrEqual(WINDOW_SECS + 200 - WINDOW_SECS - 90);
  });

  it("records headline series and per-chat series, and drops chats that are no longer live", () => {
    const s = snapshot();
    const a = record({}, s);
    expect(Object.keys(a)).toEqual(expect.arrayContaining(["mem", "tokens", "limit", "ctx:11111111-aaaa", "mem:22222222-bbbb"]));
    expect(a["ctx:33333333-cccc"]).toBeUndefined();                       // archived chats are not tracked
    const gone = snapshot({ sessions: [session({ sid: "99999999-zzzz" })], generated: s.generated + 5 });
    const b = record(a, gone);
    expect(b["ctx:11111111-aaaa"]).toBeUndefined();
    expect(b["ctx:99999999-zzzz"]).toHaveLength(1);
  });
});

describe("chart maths", () => {
  const pts = [{ t: 0, v: 0 }, { t: 10, v: 10 }, { t: 20, v: 0 }];
  it("interpolates between samples and clamps at the ends", () => {
    expect(valueAt(pts, 5)).toBe(5);
    expect(valueAt(pts, -5)).toBe(0);
    expect(valueAt(pts, 99)).toBe(0);
  });
  it("builds a smooth and a stepped path", () => {
    expect(smoothPath([[0, 10], [10, 0], [20, 10]], 20)).toMatch(/^M0.0 10.0 C.* 10.0 0.0 C/);
    expect(stepPath([[0, 10], [10, 0]])).toBe("M0.0 10.0 H10.0 V0.0");
    expect(smoothPath([[0, 1]], 20)).toBe("");
  });
});

describe("Chart", () => {
  it("says it is collecting until there is data", () => {
    render(<Chart points={[]} format={String} label="Memory" />);
    expect(screen.getByLabelText("Memory: collecting data")).toBeInTheDocument();
  });

  it("describes itself, and hovering shows the exact value", () => {
    const points = [{ t: 100, v: 4 }, { t: 110, v: 8 }, { t: 120, v: 6 }];
    render(<Chart points={points} format={(v) => `${v} MB`} label="Memory" />);
    const chart = screen.getByRole("img", { name: /Memory: now 6 MB, 3 samples over 20s/ });
    chart.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 38, right: 200, bottom: 38, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerMove(chart, { clientX: 100 });
    expect(chart.querySelector(".chart-tip")).not.toBeNull();
    fireEvent.pointerLeave(chart);
    expect(chart.querySelector(".chart-tip")).toBeNull();
  });
});

describe("charts in the app", () => {
  it("grow by one sample per snapshot", () => {
    render(<App />);
    const s = snapshot();
    act(() => FakeEventSource.last().push(s));
    expect(screen.getByRole("img", { name: /Memory held: now 200 MB, 1 samples/ })).toBeInTheDocument();
    act(() => FakeEventSource.last().push({ ...s, generated: s.generated + 5, totals: { ...s.totals, mem_mb: 250 } }));
    expect(screen.getByRole("img", { name: /Memory held: now 250 MB, 2 samples over 5s/ })).toBeInTheDocument();
  });
});
