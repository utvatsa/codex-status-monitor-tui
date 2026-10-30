import { describe, expect, it } from "vitest";
import { snapshot, session } from "../test/fixtures";
import { appLink, attentionItems } from "./attention";

describe("attentionItems", () => {
  it("is empty when nothing is wrong", () => {
    expect(attentionItems(snapshot({ sessions: [session()], usage: { limits: [], pools: [], cached_ago: null, stale: false } }))).toEqual([]);
  });

  it("lists red before amber and chats waiting on you before context warnings", () => {
    const s = snapshot({
      sessions: [
        session({ sid: "a", label: "ctx", health: "AMBER", why: ["context 88% full"], ctx_pct: 88 }),
        session({ sid: "b", label: "blocked", health: "AMBER", waiting: "Edit", why: ["waiting on a permission prompt (Edit)"] }),
        session({ sid: "c", label: "full", health: "RED", why: ["context 97% full"], ctx_pct: 97 }),
      ],
      usage: { limits: [], pools: [], cached_ago: null, stale: false },
    });
    expect(attentionItems(s).map((i) => i.title)).toEqual(["full", "blocked", "ctx"]);
  });

  it("words the headline from what the chat waits for, and skips archived chats", () => {
    const s = snapshot({ sessions: [
      session({ sid: "b", label: "blocked", health: "AMBER", waiting: "Edit", why: ["waiting on a permission prompt (Edit)"] }),
      session({ sid: "o", label: "old", active: false, health: "AMBER", why: ["context 90% full when it ended"] }),
    ], usage: { limits: [], pools: [], cached_ago: null, stale: false } });
    const items = attentionItems(s);
    expect(items).toHaveLength(1);
    expect(items[0].headline).toBe("Waiting for your approval: Edit");
  });

  it("turns limits at 80%+ into items, red from 85%", () => {
    const s = snapshot({ sessions: [], usage: { limits: [
      { label: "5-hour", pct: 82, resets: "1h", binding: true }, { label: "weekly", pct: 90, resets: "2d", binding: false }, { label: "low", pct: 10, resets: "1d", binding: false },
    ], pools: [], cached_ago: null, stale: false } });
    expect(attentionItems(s).map((i) => [i.title, i.level])).toEqual([["weekly limit", "RED"], ["5-hour limit", "AMBER"]]);
  });
});

describe("appLink", () => {
  it("links only apps that register a URL scheme", () => {
    expect(appLink("VS Code · extension")?.href).toBe("vscode://");
    expect(appLink("Cursor · extension")?.href).toBe("cursor://");
    expect(appLink("IntelliJ · ACP plugin")).toBeNull();
    expect(appLink("terminal · CLI")).toBeNull();
  });
});
