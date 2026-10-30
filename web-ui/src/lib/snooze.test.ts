import { describe, expect, it } from "vitest";
import type { SystemAlert } from "../types";
import { isMinimised, prune, snooze, unsnooze } from "./snooze";

const alert = (over: Partial<SystemAlert> = {}): SystemAlert => ({ key: "system:memory", kind: "memory", level: "AMBER", title: "t", headline: "h", tips: [], culprits: [], ...over });

describe("snooze", () => {
  it("minimises a snoozed alert, and only that alert", () => {
    const s = snooze({}, alert());
    expect(isMinimised(s, alert())).toBe(true);
    expect(isMinimised(s, alert({ key: "system:disk", kind: "disk" }))).toBe(false);
  });

  it("opens again when the alert gets worse, but not when it gets better", () => {
    const s = snooze({}, alert());
    expect(isMinimised(s, alert({ level: "RED" }))).toBe(false);
    expect(isMinimised(snooze({}, alert({ level: "RED" })), alert({ level: "AMBER" }))).toBe(true);
  });

  it("un-snoozing and clearing the condition both forget it", () => {
    const s = snooze(snooze({}, alert()), alert({ key: "system:disk", kind: "disk" }));
    expect(unsnooze(s, "system:memory")).toEqual({ "system:disk": "AMBER" });
    expect(prune(s, [alert()])).toEqual({ "system:memory": "AMBER" });       // the disk alert cleared
    expect(prune(s, [])).toEqual({});
    expect(prune(s, [alert(), alert({ key: "system:disk" })])).toBe(s);       // nothing to drop: same object, no re-render
  });

  it("an alert that got worse is forgotten, so it stays open even when it eases back to AMBER", () => {
    const s = snooze({}, alert());
    const escalated = prune(s, [alert({ level: "RED" })]);
    expect(escalated).toEqual({});                                           // dropped: the chip is gone, the full alert shows
    expect(isMinimised(escalated, alert({ level: "AMBER" }))).toBe(false);    // later AMBER again: still open until the user snoozes it again
    expect(prune(snooze({}, alert({ level: "RED" })), [alert({ level: "AMBER" })])).toEqual({ "system:memory": "RED" });   // easing never drops a snooze
  });
});
