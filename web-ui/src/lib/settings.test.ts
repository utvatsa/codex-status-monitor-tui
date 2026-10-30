import { describe, expect, it } from "vitest";
import { chatCommand, parseSize, suggestLevels } from "./settings";

describe("suggestLevels", () => {
  it("matches the Python formula (config.suggest_levels)", () => {
    const python: Record<number, [number, number]> = {
      50_000: [85, 95], 200_000: [85, 95], 300_000: [79, 94], 400_000: [74, 93], 500_000: [71, 92], 600_000: [68, 92],
      750_000: [64, 91], 1_000_000: [60, 90], 1_500_000: [54, 89], 2_000_000: [49, 88], 5_000_000: [45, 87],
    };
    for (const [w, lv] of Object.entries(python)) expect(suggestLevels(Number(w))).toEqual(lv);
  });

  it("always leaves red at least 5 points after amber", () => {
    for (let w = 50_000; w <= 3_000_000; w += 50_000) {
      const [a, r] = suggestLevels(w);
      expect(a).toBeGreaterThanOrEqual(20);
      expect(r).toBeGreaterThanOrEqual(a + 5);
      expect(r).toBeLessThanOrEqual(99);
    }
  });
});

describe("parseSize", () => {
  it("reads k, m and plain numbers, and refuses nonsense", () => {
    expect([parseSize("1m"), parseSize("600k"), parseSize("1.5m"), parseSize(500000), parseSize("bad"), parseSize("5"), parseSize("99m")]).toEqual([1_000_000, 600_000, 1_500_000, 500_000, null, null, null]);
  });
});

describe("chatCommand", () => {
  it("uses the first 8 characters of the chat id", () => {
    expect(chatCommand("3196cae4-7b9d", "600k")).toBe("cust-codex-status --set-window 3196cae4 600k");
    expect(chatCommand("3196cae4-7b9d", "600k", 70, 90)).toBe("cust-codex-status --set-window 3196cae4 600k --levels 70 90");
  });
});
