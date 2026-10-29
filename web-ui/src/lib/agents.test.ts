import { describe, expect, it } from "vitest";
import { session } from "../test/fixtures";
import { agentCards, agentCode, agentRows, agentTotals, filterCards, listStartsOpen, mainState, phaseTotals, sessionCode, subCounts, visibleSubs } from "./agents";

const sub = (running: boolean, code = "abcdef0123", phase?: "active" | "idle" | "done" | "closed") => ({ code, type: "Explore", desc: "d", model: "opus-5-5", ctx: "1k", ago: "1m", turns: 3, out: "2.0k", running, phase: phase ?? (running ? "active" : "done") });

describe("agentTotals", () => {
  it("counts live chats as main agents and only live chats' subagents", () => {
    const t = agentTotals([
      session({ subagents: [sub(true), sub(false)] }),
      session({ sid: "b" }),
      session({ sid: "c", active: false, subagents: [sub(true)] }),
    ]);
    expect(t).toEqual({ main: 2, subagents: 2, running: 1, chats: 1 });
  });
});

describe("agentCode", () => {
  it("is the first 7 characters", () => expect(agentCode("abcdef0123")).toBe("abcdef0"));
});

describe("agentRows", () => {
  it("names the main agent, tells the states apart and lists running subagents first", () => {
    const r = agentRows(session({ sid: "3196cae4-7b9d", label: "graal-c0", pid: 4242, state: "busy", subagents: [sub(false, "old0000"), sub(true, "run1111"), sub(false, "old2222")] }));
    expect(r.main).toMatchObject({ code: "3196cae4", pid: 4242, name: "graal-c0", state: "active" });
    expect(r.subs.map((a) => [a.code, a.state])).toEqual([["run1111", "active"], ["old0000", "done"], ["old2222", "done"]]);     // stable within a group
    expect(r.running).toBe(1);
    expect(r.subs[0]).toMatchObject({ turns: 3, out: "2.0k", full: "run1111" });
  });

  it("main agent states: waiting beats busy, idle is quiet, an archived chat is ended", () => {
    expect([session({ waiting: "Bash", state: "busy" }), session({ state: "busy" }), session({ state: "idle" }), session({ active: false, state: "ended" })].map(mainState))
      .toEqual(["waiting", "active", "idle", "ended"]);
  });

  it("copes with subagents from an older server (no turns / out)", () => {
    const r = agentRows(session({ subagents: [{ code: "abc1234", type: "Plan", desc: "", model: "m", ctx: "1k", ago: "1m", running: true } as never] }));
    expect(r.subs[0]).toMatchObject({ turns: 0, out: "0", state: "active" });                 // and no phase: falls back to running
  });

  it("caps the visible subagents and says how many are hidden", () => {
    const r = agentRows(session({ subagents: [sub(true, "a"), sub(true, "b"), sub(false, "c"), sub(false, "d"), sub(false, "e")] }));
    expect(visibleSubs(r, 4)).toMatchObject({ hidden: 1 });
    expect(visibleSubs(r, 4).shown).toHaveLength(4);
    expect(visibleSubs(r, 9).hidden).toBe(0);
    expect(sessionCode("eb1b84f7-2b9a")).toBe("eb1b84f7");
  });
});

describe("subagent states", () => {
  const rows = (phases: ("active" | "idle" | "done" | "closed")[]) => agentRows(session({ subagents: phases.map((p, i) => sub(p === "active", `code${i}`, p)) }));

  it("orders active, idle, done, closed and counts each", () => {
    const r = rows(["closed", "done", "idle", "active", "done"]);
    expect(r.subs.map((a) => a.state)).toEqual(["active", "idle", "done", "done", "closed"]);
    expect(subCounts(r)).toEqual({ active: 1, idle: 1, done: 2, closed: 1 });
  });

  it("starts open only when something is still going on and the list is short", () => {
    expect(listStartsOpen(rows(["active", "done"]))).toBe(true);
    expect(listStartsOpen(rows(["idle"]))).toBe(true);
    expect(listStartsOpen(rows(["done", "done", "closed"]))).toBe(false);
    expect(listStartsOpen(rows(["active", "done", "done", "done", "done"]))).toBe(false);       // 5 subagents: long, so collapsed
    expect(listStartsOpen(rows([]))).toBe(false);
  });
});

describe("the Agents view", () => {
  const phases = (...p: ("active" | "idle" | "done" | "closed")[]) => p.map((x, i) => sub(x === "active", `c${i}${x}`, x));
  const sessions = () => [
    session({ sid: "idle0001", label: "quiet-chat", pid: 11, state: "idle", subagents: phases("done", "closed") }),
    session({ sid: "busy0002", label: "busy-chat", pid: 22, state: "busy", subagents: phases("active", "idle", "done") }),
    session({ sid: "wait0003", label: "waiting-chat", pid: 33, waiting: "Bash", state: "busy" }),
    session({ sid: "gone0004", label: "old-chat", active: false, state: "ended", subagents: phases("closed") }),
  ];

  it("makes one card per live chat: working, then waiting, then idle", () => {
    expect(agentCards(sessions()).map((c) => c.session.label)).toEqual(["busy-chat", "waiting-chat", "quiet-chat"]);       // the ended chat has no card
  });

  it("totals the states over every card", () => {
    expect(phaseTotals(agentCards(sessions()))).toEqual({ active: 1, idle: 1, done: 2, closed: 1 });
  });

  it("filters by state: keeps only that state's subagents and drops chats with none", () => {
    const r = filterCards(agentCards(sessions()), "done", "");
    expect(r.map((c) => [c.session.label, c.rows.subs.length])).toEqual([["busy-chat", 1], ["quiet-chat", 1]]);
    expect(filterCards(agentCards(sessions()), "active", "").map((c) => c.session.label)).toEqual(["busy-chat"]);
  });

  it("keeps a chat without subagents under 'all' but not under a state", () => {
    expect(filterCards(agentCards(sessions()), "all", "").map((c) => c.session.label)).toContain("waiting-chat");
    expect(filterCards(agentCards(sessions()), "idle", "").map((c) => c.session.label)).not.toContain("waiting-chat");
  });

  it("text filter: a matching chat keeps all its subagents, a chat with only matching subagents keeps just those", () => {
    const cards = agentCards(sessions());
    expect(filterCards(cards, "all", "busy-chat")[0].rows.subs).toHaveLength(3);
    const byDesc = filterCards(cards, "all", "c1idle");                                  // matches one subagent's code only
    expect(byDesc.map((c) => [c.session.label, c.rows.subs.map((a) => a.state)])).toEqual([["busy-chat", ["idle"]]]);
    expect(filterCards(cards, "all", "22").map((c) => c.session.label)).toEqual(["busy-chat"]);   // by pid
    expect(filterCards(cards, "all", "nothing-like-this")).toEqual([]);
  });
});
