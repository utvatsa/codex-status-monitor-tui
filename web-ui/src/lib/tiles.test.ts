import { describe, expect, it } from "vitest";
import { session, snapshot } from "../test/fixtures";
import { headroomLevel, headroomOf, limitLevel, metricsOf, mixText, tightest, tileFacts } from "./tiles";

describe("tile facts", () => {
  it("uses the server's metrics", () => {
    const f = tileFacts(snapshot());
    expect(f.m.cache_pct).toBe(87);
    expect(f.headroom).toBe(11);
    expect(f.headroomChat).toBe("busy-chat");
    expect(f.cacheText).toBe("60.0k cached of 68.0k input");
    expect(f.reasoningText).toBe("600 of 2.4k output");
    expect(f.limit?.label).toBe("5-hour session");
  });

  it("falls back to the sessions when an older server sends no metrics", () => {
    const s = snapshot();
    delete (s.totals as { metrics?: unknown }).metrics;
    expect(metricsOf(s).threads).toBe(2);
    expect(metricsOf(s).cache_pct).toBeNull();
    const f = tileFacts(s);
    expect(f.headroom).toBe(11);                       // 100 - the tightest live chat's 89%
    expect(f.headroomChat).toBe("busy-chat");
  });

  it("judges headroom against the tightest chat's own alert levels", () => {
    const s = [session({ ctx_pct: 50 }), session({ sid: "b", ctx_pct: 90, ctx_amber_pct: 85, ctx_red_pct: 95 })];
    expect(tightest(s)?.sid).toBe("b");
    expect(headroomOf(s)).toBe(10);
    expect(headroomLevel(s)).toBe("warn");
    expect(headroomLevel([session({ ctx_pct: 96, ctx_red_pct: 95 })])).toBe("bad");
    expect(headroomOf([session({ active: false })])).toBeNull();
  });

  it("formats the mixes and rate-limit levels", () => {
    expect(mixText([["medium", 3], ["high", 1]])).toBe("medium 3 · high 1");
    expect([limitLevel(10), limitLevel(60), limitLevel(90)]).toEqual(["good", "warn", "bad"]);
  });
});
