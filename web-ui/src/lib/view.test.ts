import { describe, expect, it } from "vitest";
import { clampLevel, flagsFor, stepLevel, viewIndex } from "./view";

describe("the view dial (same as views.apply_level in Python)", () => {
  it("buckets levels into five views", () => {
    expect([0, 19, 20, 44, 45, 69, 70, 89, 90, 100].map(viewIndex)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("sets the flags each view implies", () => {
    expect(flagsFor(75)).toEqual({ minimal: false, compact: false, lean: false, noPrompts: true, showArc: false, verbose: false });
    expect(flagsFor(95)).toMatchObject({ noPrompts: false, showArc: true, verbose: true });
    expect(flagsFor(10)).toMatchObject({ minimal: true, compact: true, lean: true });
  });

  it("steps between representative levels and stops at the ends", () => {
    expect(stepLevel(75, 1)).toBe(95);
    expect(stepLevel(75, -1)).toBe(60);
    expect(stepLevel(95, 1)).toBe(95);
    expect(stepLevel(0, -1)).toBe(10);
  });

  it("clamps", () => {
    expect([clampLevel(-5), clampLevel(140), clampLevel(42.6)]).toEqual([0, 100, 43]);
  });
});
