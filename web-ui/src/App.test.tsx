// Component tests: render the real App, feed it a snapshot through the fake EventSource, and drive it the way a
// person would (keys and clicks), checking what is on screen rather than internal state.
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { ToastProvider } from "./components/ui/Toast";
import { diskAlert, memoryAlert, session, snapshot } from "./test/fixtures";
import { FakeEventSource } from "./test/setup";

function renderWith(data = snapshot()) {
  const user = userEvent.setup();
  render(<ToastProvider><App /></ToastProvider>);
  act(() => FakeEventSource.last().push(data));
  return user;
}

describe("App", () => {
  it("shows a loading skeleton until the first snapshot", () => {
    render(<ToastProvider><App /></ToastProvider>);
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  });

  it("the badge says the data is read-only and the tooltip names the one thing that can change", () => {
    renderWith();
    expect(screen.getByText("read-only data")).toHaveAttribute("title", expect.stringContaining("context window and alert levels of a single chat"));
  });

  it("renders the account, KPIs, usage, attention and live chats", () => {
    renderWith();
    expect(screen.getByRole("heading", { name: "test@example.com" })).toBeInTheDocument();
    expect(screen.getByText("Live chats", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("5-hour session")).toBeInTheDocument();
    const attention = screen.getByRole("region", { name: /Attention/ });
    expect(within(attention).getByText("busy-chat")).toBeInTheDocument();
    expect(within(attention).getByText(/Context 89% of 200.0k/)).toBeInTheDocument();
    expect(within(attention).getByText(/terminal · CLI/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /demo-chat · Fix the thing/ })).toBeInTheDocument();
    expect(screen.queryByText("Old chat")).not.toBeInTheDocument();      // archived is off at level 75
  });

  it("↓ moves the highlight, ⏎ selects, ⏎ again copies the resume command, Esc goes back", async () => {
    const user = renderWith();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByText("NAVIGATE")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(screen.getByText("SELECTED")).toBeInTheDocument();
    expect(screen.getByLabelText("Details of busy-chat")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe("cd ~/big && codex resume 22222222-bbbb");
    expect(await screen.findByText("Copied the resume command")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByText("NAVIGATE")).toBeInTheDocument();
  });

  it("a toggles archived chats on; 1-5 switch views", async () => {
    const user = renderWith();
    await user.keyboard("a");
    expect(screen.getByText("Old chat")).toBeInTheDocument();
    await user.keyboard("2");
    expect(screen.getByRole("radio", { name: "compact" })).toHaveAttribute("aria-checked", "true");
  });

  it("asks the server for archived chats when they were not read yet", async () => {
    const user = renderWith(snapshot({ view: { ...snapshot().view, has_arc: false } }));
    await user.keyboard("a");
    expect(screen.getByText("Reading archived chats…")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/refresh", expect.objectContaining({ method: "POST", body: JSON.stringify({ archived: true }) }));
  });

  it("filters by text and Esc in the box clears it", async () => {
    const user = renderWith();
    await user.keyboard("/");
    await user.keyboard("busy");
    expect(screen.queryByRole("heading", { name: /demo-chat · Fix the thing/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /busy-chat · Big refactor/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("heading", { name: /demo-chat · Fix the thing/ })).toBeInTheDocument();
  });

  it("copy buttons copy, and the theme menu sets data-theme on <html>", async () => {
    const user = renderWith();
    const card = screen.getByRole("heading", { name: /demo-chat · Fix the thing/ }).closest("article")!;
    await user.click(within(card).getByRole("button", { name: /Copy/ }));
    expect(await navigator.clipboard.readText()).toBe("cd ~/proj && codex resume 11111111-aaaa");
    await user.click(screen.getByRole("button", { name: /Switch theme/ }));
    await user.click(screen.getByRole("option", { name: /Dark · Nord/ }));
    expect(document.documentElement.dataset.theme).toBe("nord");
  });

  it("on a narrow screen the details open under the selected row instead of a side panel", async () => {
    (globalThis as { matchMediaWide?: boolean }).matchMediaWide = false;
    try {
      const user = renderWith();
      await user.keyboard("{Enter}");
      expect(screen.queryByLabelText(/Details of/)).not.toBeInTheDocument();
      expect(screen.getByText("first prompt text")).toBeInTheDocument();   // prompts are off in the card, on in the details
    } finally {
      (globalThis as { matchMediaWide?: boolean }).matchMediaWide = true;
    }
  });

  it("keys are ignored while the shortcuts dialog is open, except ?", async () => {
    const user = renderWith();
    await user.keyboard("?");
    await user.keyboard("a");
    expect(screen.queryByText("Old chat")).not.toBeInTheDocument();
  });

  it("attention: a compact summary of the item in focus; arrows switch; a click opens details with the app link", async () => {
    const sessions = [
      session({ sid: "w1", label: "waiter", name: "waiter", health: "AMBER", waiting: "Bash", why: ["waiting on a permission prompt (Bash)"],
        tips: ["answer it in VS Code · extension"], running_in: "VS Code · extension", folder: "~/api" }),
      ...snapshot().sessions,
    ];
    const user = renderWith(snapshot({ sessions }));
    const region = screen.getByRole("region", { name: /Attention/ });
    expect(within(region).getByLabelText("2 need attention")).toBeInTheDocument();
    expect(within(region).getByText("waiter")).toBeInTheDocument();                           // blocked-on-you comes first
    expect(within(region).getByText("Waiting for your approval: Bash")).toBeInTheDocument();
    expect(within(region).getByText(/VS Code · extension/)).toBeInTheDocument();
    expect(within(region).queryByRole("link", { name: /Open VS Code/ })).not.toBeInTheDocument();   // details are closed
    await user.click(within(region).getByRole("button", { name: /Waiting for your approval/ }));
    expect(within(region).getByRole("link", { name: /Open VS Code/ })).toHaveAttribute("href", "vscode://");
    expect(within(region).getByText("~/api")).toBeInTheDocument();
    await user.click(within(region).getByRole("button", { name: "Next item" }));
    expect(within(region).getByText("busy-chat")).toBeInTheDocument();
    expect(within(region).queryByText("~/api")).not.toBeInTheDocument();                       // switching closes the details
  });

  it("attention: a usage limit near its cap is an item", () => {
    renderWith(snapshot({ usage: { limits: [{ label: "weekly", pct: 91, resets: "2d", binding: true }], pools: [], cached_ago: "1m", stale: false } }));
    expect(within(screen.getByRole("region", { name: /Attention/ })).getByText("weekly limit")).toBeInTheDocument();
  });

  it("the Agents tile counts main agents plus running subagents", () => {
    const sub = (code: string, running: boolean) => ({ code, type: "Explore", desc: "look around", model: "opus-5-5", ctx: "9k", ago: "1m", turns: 4, out: "1.2k", phase: (running ? "active" : "done") as "active" | "done", running });
    const sessions = snapshot().sessions;
    sessions[0] = session({ subagents: [sub("abcdef0123", true), sub("1234567890", false)] });
    renderWith(snapshot({ sessions }));
    const tile = screen.getByText("Agents", { selector: "span" }).closest("div")!.parentElement!;
    expect(within(tile).getByText("3")).toBeInTheDocument();                    // 2 live chats + 1 running subagent
    expect(within(tile).getByText(/2 main · 1 subagent running/)).toBeInTheDocument();
  });
});

describe("card: id, pid and subagents", () => {
  const sub = (code: string, running: boolean, over: Record<string, unknown> = {}) => ({ code, type: "Explore", desc: "look around", model: "opus-5-5", ctx: "9k", ago: "1m", turns: 4, out: "1.2k", phase: (running ? "active" : "done") as "active" | "done", running, ...over });
  const cardOf = () => document.querySelector<HTMLElement>("article[data-sid]")!;

  it("the stats line has id and pid buttons that copy the full values and do not select the card", async () => {
    const user = renderWith(snapshot({ sessions: [session({ sid: "11111111-aaaa-bbbb-cccc" })] }));
    await user.click(within(cardOf()).getByText("#11111111"));
    expect(await navigator.clipboard.readText()).toBe("11111111-aaaa-bbbb-cccc");
    expect(await screen.findByText("Copied the session id")).toBeInTheDocument();
    await user.click(within(cardOf()).getByText("123"));
    expect(await navigator.clipboard.readText()).toBe("123");
    expect(cardOf()).not.toHaveAttribute("aria-current");
    expect(screen.queryByText("SELECTED")).not.toBeInTheDocument();
  });

  it("no pid button when the chat has no pid", () => {
    renderWith(snapshot({ sessions: [session({ pid: null })] }));
    expect(within(cardOf()).queryByTitle("Copy the pid")).not.toBeInTheDocument();
  });

  it("a short list with an active subagent starts open: code, type, description, stats, a tag per state; the code copies in full", async () => {
    const subs = [sub("1111111xxxx", false, { desc: "done one" }), sub("abcdef0123456", true, { desc: "map the repo" })];
    const user = renderWith(snapshot({ sessions: [session({ subagents: subs })] }));
    const items = within(cardOf()).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Explore#abcdef0activemap the repoopus-5-5 · 9k · 4t · 1.2k out · 1m");   // active first
    expect(items[0]).toHaveAttribute("data-state", "active");
    expect(items[1]).toHaveAttribute("data-state", "done");
    expect(items[1]).toHaveTextContent("✓ done");
    await user.click(within(items[0]).getByText("#abcdef0"));
    expect(await navigator.clipboard.readText()).toBe("abcdef0123456");
    expect(await screen.findByText("Copied the agent id")).toBeInTheDocument();
    expect(cardOf()).not.toHaveAttribute("aria-current");
  });

  it("every state has its tag text, data-state, a hint, and done / closed lines carry their own state for dimming", () => {
    const subs = [sub("a000000x", false, { phase: "closed" }), sub("b000000x", false, { phase: "idle" }), sub("c000000x", false), sub("d000000x", true)];
    renderWith(snapshot({ sessions: [session({ subagents: subs })] }));
    const items = within(cardOf()).getAllByRole("listitem");
    expect(items.map((i) => i.getAttribute("data-state"))).toEqual(["active", "idle", "done", "closed"]);   // sorted: active, idle, done, closed
    expect(within(items[1]).getByText("idle")).toHaveAttribute("title", expect.stringContaining("quiet"));
    expect(items[3]).toHaveTextContent("⊘ closed");
  });

  it("the header counts each non-zero state with text and toggles the list; the card is not selected", async () => {
    const subs = [sub("a000000x", true), sub("b000000x", true), sub("c000000x", false), sub("d000000x", false, { phase: "closed" })];
    const user = renderWith(snapshot({ sessions: [session({ subagents: subs })] }));
    const head = within(cardOf()).getByRole("button", { name: /subagents \(4\)/ });
    expect(head).toHaveTextContent("● 2 active");
    expect(head).toHaveTextContent("✓ 1 done");
    expect(head).toHaveTextContent("⊘ 1 closed");
    expect(head).not.toHaveTextContent("idle");
    expect(head).toHaveAttribute("aria-expanded", "true");
    await user.click(head);
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(within(cardOf()).queryAllByRole("listitem")).toHaveLength(0);
    expect(cardOf()).not.toHaveAttribute("aria-current");
    await user.click(head);
    expect(within(cardOf()).getAllByRole("listitem")).toHaveLength(4);
  });

  it("a list of 5 or more, or one with nothing going on, starts collapsed", () => {
    const many = ["a", "b", "c", "d", "e"].map((c) => sub(`${c}000000x`, true));
    renderWith(snapshot({ sessions: [session({ subagents: many }), session({ sid: "22222222-bbbb", label: "other", name: "other", subagents: [sub("z000000x", false)] })] }));
    for (const c of document.querySelectorAll<HTMLElement>("article[data-sid]")) expect(within(c).queryAllByRole("listitem")).toHaveLength(0);
    expect(within(cardOf()).getByRole("button", { name: /subagents \(5\)/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("the user's choice survives a new snapshot and a re-sort", async () => {
    const subs = ["a", "b", "c", "d", "e"].map((c) => sub(`${c}000000x`, true));
    const user = renderWith(snapshot({ sessions: [session({ subagents: subs })] }));
    await user.click(within(cardOf()).getByRole("button", { name: /subagents \(5\)/ }));         // collapsed by default: open it
    expect(within(cardOf()).getAllByRole("listitem")).toHaveLength(5);
    const next = ["a", "b", "c", "d", "e"].map((c, i) => sub(`${c}000000x`, i > 1));              // a and b go done: the list re-sorts
    act(() => FakeEventSource.last().push(snapshot({ sessions: [session({ subagents: next })] })));
    expect(within(cardOf()).getAllByRole("listitem")).toHaveLength(5);
    expect(within(cardOf()).getAllByRole("listitem")[0]).toHaveAttribute("data-state", "active");
    await user.click(within(cardOf()).getByRole("button", { name: /subagents \(5\)/ }));         // close it, refresh again
    act(() => FakeEventSource.last().push(snapshot({ sessions: [session({ subagents: subs })] })));
    expect(within(cardOf()).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("a list the user opened stays open after a trip to the Agents view and back", async () => {
    const subs = ["a", "b", "c", "d", "e"].map((c) => sub(`${c}000000x`, true));
    const user = renderWith(snapshot({ sessions: [session({ subagents: subs })] }));
    await user.click(within(cardOf()).getByRole("button", { name: /subagents \(5\)/ }));         // collapsed by default: open it
    expect(within(cardOf()).getAllByRole("listitem")).toHaveLength(5);
    await user.keyboard("A");                                                                       // the Agents view replaces the chat list
    expect(document.querySelector("article[data-sid]")).toBeNull();
    await user.keyboard("A");                                                                       // and back
    expect(within(cardOf()).getAllByRole("listitem")).toHaveLength(5);                              // still open
  });

  it("the details panel starts open even for a long list, and can be toggled", async () => {
    const subs = ["a", "b", "c", "d", "e", "f"].map((c) => sub(`${c}000000x`, false));
    const user = renderWith(snapshot({ sessions: [session({ subagents: subs })] }));
    await user.click(within(cardOf()).getByRole("heading"));                                      // select: the panel shows it
    const panel = within(screen.getByLabelText("Details of demo-chat"));
    expect(panel.getAllByRole("listitem")).toHaveLength(6);
    await user.click(panel.getByRole("button", { name: /subagents \(6\)/ }));
    expect(panel.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("the card clamps prompts to one line; the details panel does not", async () => {
    const user = renderWith(snapshot({ sessions: [session()] }));
    await user.keyboard("5");                                                    // full view shows prompts
    expect(within(cardOf()).getByText("first prompt text").className).toMatch(/prompt1/);
    await user.keyboard("{ArrowDown}");
    expect(within(screen.getByLabelText("Details of demo-chat")).getByText("first prompt text").className).not.toMatch(/prompt1/);
  });
});

const lastPost = () => {
  const calls = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/config");
  return calls.length ? JSON.parse(String((calls[calls.length - 1][1] as RequestInit).body)) : null;
};
const detailsOf = (name: string) => within(screen.getByLabelText(`Details of ${name}`));

describe("chat footprint and housekeeping", () => {
  const files = { total_mb: 412, parts: [["results", 330], ["file history", 40.4], ["temp", 30], ["transcript", 0.6]] as [string, number][] };
  const advice = [{ kind: "delete-scratch" as const, text: "Delete 330 MB of old tool results", command: "rm -rf ~/.codex/tool-results/1111" }];

  it("a card shows the disk total and the parts of 1 MB or more, and a housekeeping block with a copy button", async () => {
    const user = renderWith(snapshot({ sessions: [session({ files, advice })] }));
    const card = screen.getByRole("heading", { name: /demo-chat · Fix the thing/ }).closest("article")!;
    expect(within(card).getByText(/^Disk/)).toHaveTextContent("Disk 412 MB · results 330 · file history 40 · temp 30");
    expect(card).not.toHaveTextContent("transcript 0.6");                        // under 1 MB: hidden
    expect(within(card).getByText("Delete 330 MB of old tool results")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: /Copy command/ }));
    expect(await navigator.clipboard.readText()).toBe("rm -rf ~/.codex/tool-results/1111");
  });

  it("compact rows carry the total only; the details panel has everything, with the command shown", async () => {
    const user = renderWith(snapshot({ sessions: [session({ files, advice })] }));
    expect(detailsOf("demo-chat").getByText("Delete 330 MB of old tool results")).toBeInTheDocument();
    expect(detailsOf("demo-chat").getByText("rm -rf ~/.codex/tool-results/1111")).toBeInTheDocument();
    await user.keyboard("2");
    const row = document.querySelector('[data-sid="11111111-aaaa"]') as HTMLElement;
    expect(row).toHaveTextContent("412 MB");
    expect(row).not.toHaveTextContent("results 330");
  });

  it("shows nothing for a chat without a footprint or advice", () => {
    renderWith(snapshot({ sessions: [session({ files: null })] }));
    expect(screen.queryByText(/^Disk/)).not.toBeInTheDocument();
    expect(screen.queryByText("Housekeeping")).not.toBeInTheDocument();
  });
});

describe("context window control (per chat)", () => {
  beforeEach(() => { vi.mocked(fetch).mockClear(); });
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(detailsOf("demo-chat").getByRole("button", { name: "Change the context window" }));
    return within(screen.getByRole("group", { name: "Change the context window" }));
  };
  const setPct = async (user: ReturnType<typeof userEvent.setup>, ed: ReturnType<typeof within>, name: string, v: string) => {
    await user.clear(ed.getByLabelText(name));
    await user.type(ed.getByLabelText(name), v);
  };

  it("shows the size, where it came from and the alert levels", () => {
    renderWith();
    expect(detailsOf("demo-chat").getByText(/a guess: 200k/)).toBeInTheDocument();
    expect(detailsOf("demo-chat").getByText(/alerts at/)).toHaveTextContent("alerts at 170.0k / 190.0k");
  });

  it("a dropdown of sizes starts on the chat's current size and says what applies where", async () => {
    const user = renderWith();
    const ed = await open(user);
    const sel = ed.getByLabelText("Maximum context") as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(["200k", "300k", "400k", "500k", "600k", "800k", "1M (recommended)", "1.5M", "2M", "Custom…"]);
    expect(sel.value).toBe("200k");
    expect(ed.getByText(/this chat only/)).toBeInTheDocument();
    expect(ed.getByLabelText("Amber percent")).toHaveValue(85);
    expect(ed.getByLabelText("Amber tokens")).toHaveValue("170k");
  });

  it("a size that is not in the list opens on Custom with that size", async () => {
    const user = renderWith(snapshot({ sessions: [session({ window: "750.0k", window_tokens: 750_000 })] }));
    const ed = await open(user);
    expect(ed.getByLabelText("Maximum context")).toHaveValue("custom");
    expect(ed.getByLabelText("Custom size")).toHaveValue("750k");
  });

  it("picking a size re-suggests both rows and shows the summary, zone bar and command live", async () => {
    const user = renderWith();
    const ed = await open(user);
    await user.selectOptions(ed.getByLabelText("Maximum context"), "600k");
    expect(ed.getByLabelText("Amber percent")).toHaveValue(68);
    expect(ed.getByLabelText("Red percent")).toHaveValue(92);
    expect(ed.getByLabelText("Amber tokens")).toHaveValue("408k");
    expect(ed.getByLabelText("Red tokens")).toHaveValue("552k");
    expect(ed.getByText(/Alerts at/)).toHaveTextContent("Alerts at 408k (amber) and 552k (red) of 600k.");
    expect(ed.getByRole("img", { name: "ok up to 68%, amber 68% to 92%, red from 92%" })).toBeInTheDocument();
    expect(ed.getByText("cust-codex-status --set-window 11111111 600k --levels 68 92")).toBeInTheDocument();
  });

  it("percent and tokens are linked both ways", async () => {
    const user = renderWith();
    const ed = await open(user);
    await user.selectOptions(ed.getByLabelText("Maximum context"), "600k");
    await setPct(user, ed, "Amber percent", "70");
    expect(ed.getByLabelText("Amber tokens")).toHaveValue("420k");
    await setPct(user, ed, "Red tokens", "540k");
    expect(ed.getByLabelText("Red percent")).toHaveValue(90);
    expect(ed.getByText("cust-codex-status --set-window 11111111 600k --levels 70 90")).toBeInTheDocument();
  });

  it("a row edited by hand keeps its percentage when the maximum changes; the other follows the suggestion", async () => {
    const user = renderWith();
    const ed = await open(user);
    await user.selectOptions(ed.getByLabelText("Maximum context"), "600k");
    await setPct(user, ed, "Amber percent", "70");
    await user.selectOptions(ed.getByLabelText("Maximum context"), "1m");
    expect(ed.getByLabelText("Amber percent")).toHaveValue(70);
    expect(ed.getByLabelText("Amber tokens")).toHaveValue("700k");
    expect(ed.getByLabelText("Red percent")).toHaveValue(90);               // not edited: re-suggested for 1M
    await user.click(ed.getByRole("button", { name: "Use suggested (60% / 90%)" }));
    expect(ed.getByLabelText("Amber percent")).toHaveValue(60);
    expect(ed.getByLabelText("Amber tokens")).toHaveValue("600k");
  });

  it("refuses levels that do not fit, and sizes that are not sizes; Apply stays disabled", async () => {
    const user = renderWith();
    const ed = await open(user);
    await user.selectOptions(ed.getByLabelText("Maximum context"), "600k");
    await setPct(user, ed, "Amber percent", "95");
    expect(ed.getByRole("alert")).toHaveTextContent(/lower than red/);
    expect(ed.getByRole("button", { name: "Apply to this chat" })).toBeDisabled();
    await setPct(user, ed, "Amber percent", "50");
    await setPct(user, ed, "Red tokens", "700k");              // more than the maximum
    expect(ed.getByRole("alert")).toHaveTextContent(/up to the maximum \(600k\)/);
    expect(ed.getByRole("button", { name: "Apply to this chat" })).toBeDisabled();
    await user.selectOptions(ed.getByLabelText("Maximum context"), "custom");
    await setPct(user, ed, "Custom size", "5");
    expect(ed.getByRole("alert")).toHaveTextContent(/between 10k and 10M/);
  });

  it("Apply posts this chat's change only, closes the editor and toasts", async () => {
    const user = renderWith();
    const ed = await open(user);
    await user.selectOptions(ed.getByLabelText("Maximum context"), "600k");
    await user.click(ed.getByRole("button", { name: "Apply to this chat" }));
    expect(lastPost()).toEqual({ chat: { sid: "11111111-aaaa", window: "600k", amber: 68, red: 92 } });
    expect(await screen.findByText("Window set to 600k for this chat")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Change the context window" })).not.toBeInTheDocument();
  });

  it("shows the server's error and keeps the command to copy", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "config is read-only" }), { status: 400 }));
    const user = renderWith();
    const ed = await open(user);
    await user.selectOptions(ed.getByLabelText("Maximum context"), "1m");
    await user.click(ed.getByRole("button", { name: "Apply to this chat" }));
    expect(await ed.findByText(/Not saved: config is read-only/)).toBeInTheDocument();
    await user.click(ed.getByRole("button", { name: /Copy command/ }));
    expect(await navigator.clipboard.readText()).toBe("cust-codex-status --set-window 11111111 1m --levels 60 90");
  });

  it("Reset to automatic exists only for a window set on this chat, and clears just that chat", async () => {
    const user = renderWith();
    expect((await open(user)).queryByRole("button", { name: "Reset to automatic" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    act(() => FakeEventSource.last().push(snapshot({ sessions: [session({ window_source: "chat", window: "600.0k", window_tokens: 600_000, levels_custom: true, ctx_amber_pct: 70, ctx_red_pct: 92 })] })));
    const ed = await open(user);
    expect(ed.getByLabelText("Maximum context")).toHaveValue("600k");
    expect(ed.getByLabelText("Amber percent")).toHaveValue(70);
    await user.click(ed.getByRole("button", { name: "Reset to automatic" }));
    expect(lastPost()).toEqual({ chat: { sid: "11111111-aaaa", clear: true } });
  });
});

describe("attention: window offer", () => {
  const guess = session({ sid: "22222222-bbbb", label: "busy-chat", health: "AMBER", why: ["context 89% full"], ctx_pct: 89, maybe_1m: true,
    window_offer: { sid: "22222222-bbbb", size: "1m", amber: 60, red: 90, command: "cust-codex-status --set-window 22222222 1m --levels 60 90" } });
  const openOffer = async () => {
    vi.mocked(fetch).mockClear();
    const user = renderWith(snapshot({ sessions: [guess] }));
    const region = screen.getByRole("region", { name: /Attention/ });
    await user.click(within(region).getByRole("button", { name: /Context 89%/ }));
    return { user, region };
  };

  it("offers the compact editor with 1M preselected, the summary, and Apply / Copy", async () => {
    const { user, region } = await openOffer();
    expect(within(region).getByText(/a guess: 200k/)).toBeInTheDocument();
    expect(within(region).getByText("This chat is judged against an assumed 200k window. If its real window is bigger, set it here.")).toBeInTheDocument();
    expect(within(region).getByLabelText("Maximum context")).toHaveValue("1m");
    expect(within(region).getByText(/Alerts at/)).toHaveTextContent("Alerts at 600k (amber) and 900k (red) of 1M.");
    expect(within(region).queryByLabelText("Amber percent")).not.toBeInTheDocument();          // thresholds are behind the disclosure
    await user.click(within(region).getByRole("button", { name: "Edit thresholds" }));
    expect(within(region).getByLabelText("Amber percent")).toHaveValue(60);
    await user.click(within(region).getByRole("button", { name: /Copy command/ }));
    expect(await navigator.clipboard.readText()).toBe("cust-codex-status --set-window 22222222 1m --levels 60 90");
  });

  it("Apply sets the chosen size for that chat only", async () => {
    const { user, region } = await openOffer();
    await user.selectOptions(within(region).getByLabelText("Maximum context"), "800k");
    await user.click(within(region).getByRole("button", { name: "Apply to this chat" }));
    expect(lastPost()).toEqual({ chat: { sid: "22222222-bbbb", window: "800k", amber: 63, red: 91 } });
  });
});

describe("context meter and legend", () => {
  it("marks the chat's own amber and red levels", () => {
    renderWith(snapshot({ sessions: [session({ ctx_amber_pct: 60, ctx_red_pct: 90 })] }));
    const card = screen.getByRole("heading", { name: /demo-chat · Fix the thing/ }).closest("article")!;
    expect(within(card).getByTestId("mark-amber")).toHaveStyle({ left: "60%" });
    expect(within(card).getByTestId("mark-red")).toHaveStyle({ left: "90%" });
  });

  it("the legend uses the server's rules for 200k and 1M windows", () => {
    renderWith();
    expect(screen.getByText(/context ≥85% \(200k\) \/ ≥60% \(1M\), waiting on a prompt, memory, or idle >1h/)).toBeInTheDocument();
    expect(screen.getByText(/context ≥95% \/ ≥90%/)).toBeInTheDocument();
  });
});

describe("machine band", () => {
  const withSystem = (system = [memoryAlert(), diskAlert()]) => snapshot({ system });

  it("is absent without machine alerts, and does not feed the chat tiles or the Attention card", () => {
    renderWith();
    expect(screen.queryByRole("region", { name: "Machine" })).not.toBeInTheDocument();
  });

  it("appears with its own count, separate from Attention and the health tiles", () => {
    renderWith(withSystem());
    const band = screen.getByRole("region", { name: "Machine" });
    expect(within(band).getByLabelText("2 machine alerts")).toBeInTheDocument();
    expect(within(band).getByText("Chats hold 11.2 GB of 16 GB")).toBeInTheDocument();
    expect(within(band).getByText("Close the chats you no longer need.")).toBeInTheDocument();
    const attention = screen.getByRole("region", { name: /Attention/ });
    expect(within(attention).queryByText("Memory is tight")).not.toBeInTheDocument();
    expect(within(attention).getByLabelText("1 needs attention")).toBeInTheDocument();
  });

  it("Snooze minimises an alert to a chip, and a click on the chip expands it again", async () => {
    const user = renderWith(withSystem([memoryAlert()]));
    const band = screen.getByRole("region", { name: "Machine" });
    await user.click(within(band).getByRole("button", { name: "Snooze" }));
    expect(within(band).queryByText("Close the chats you no longer need.")).not.toBeInTheDocument();
    const chip = within(band).getByRole("button", { name: "Show Memory is tight" });
    expect(chip).toHaveTextContent("Chats hold 11.2 GB of 16 GB");               // still there while the condition lasts
    expect(JSON.parse(localStorage.getItem("cust-codex-status.snoozed")!)).toEqual({ "system:memory": "AMBER" });
    await user.click(chip);
    expect(within(band).getByText("Close the chats you no longer need.")).toBeInTheDocument();
    expect(localStorage.getItem("cust-codex-status.snoozed")).toBe("{}");
  });

  it("a snoozed alert opens when it turns RED and stays open when it drops back; a cleared one is forgotten", async () => {
    const user = renderWith(withSystem([memoryAlert()]));
    await user.click(screen.getByRole("button", { name: "Snooze" }));
    act(() => FakeEventSource.last().push(snapshot({ system: [memoryAlert({ level: "RED", headline: "Chats hold 15.4 GB of 16 GB" })] })));
    expect(screen.getByText("Close the chats you no longer need.")).toBeInTheDocument();
    act(() => FakeEventSource.last().push(snapshot({ system: [memoryAlert()] })));
    expect(screen.getByText("Close the chats you no longer need.")).toBeInTheDocument();       // back to AMBER: still expanded
    expect(localStorage.getItem("cust-codex-status.snoozed")).toBe("{}");
    await user.click(screen.getByRole("button", { name: "Snooze" }));
    act(() => FakeEventSource.last().push(snapshot({ system: [] })));
    expect(screen.queryByRole("region", { name: "Machine" })).not.toBeInTheDocument();
    expect(localStorage.getItem("cust-codex-status.snoozed")).toBe("{}");
  });

  it("remembers a snooze across a reload", () => {
    localStorage.setItem("cust-codex-status.snoozed", JSON.stringify({ "system:memory": "AMBER" }));
    renderWith(withSystem([memoryAlert()]));
    expect(screen.getByRole("button", { name: "Show Memory is tight" })).toBeInTheDocument();
  });

  it("a culprit button selects that chat", async () => {
    const user = renderWith(withSystem([memoryAlert()]));
    await user.click(within(screen.getByRole("region", { name: "Machine" })).getByRole("button", { name: "Show chat busy-chat" }));
    expect(screen.getByText("SELECTED")).toBeInTheDocument();
    expect(screen.getByLabelText("Details of busy-chat")).toBeInTheDocument();
  });

  it("the disk alert says what could be freed and shows those chats (archived on, first one selected)", async () => {
    const user = renderWith(withSystem([diskAlert({ reclaim_chats: ["33333333-cccc"] })]));
    const band = screen.getByRole("region", { name: "Machine" });
    expect(within(band).getByText(/could be freed from 1 ended chat/)).toHaveTextContent("1,840 MB could be freed from 1 ended chat");
    expect(screen.queryByText("Old chat")).not.toBeInTheDocument();
    await user.click(within(band).getByRole("button", { name: "Show those chats" }));
    expect(document.querySelector('[data-sid="33333333-cccc"]')).toBeInTheDocument();
    expect(screen.getByLabelText("Details of Old chat")).toBeInTheDocument();
    expect(screen.getByText("SELECTED")).toBeInTheDocument();
  });
});


describe("agents view", () => {
  const sub = (code: string, running: boolean, over: Record<string, unknown> = {}) => ({ code, type: "Explore", desc: "look around", model: "opus-5-5", ctx: "9k", ago: "1m", turns: 4, out: "1.2k", phase: (running ? "active" : "done") as "active" | "done", running, ...over });
  const data = () => snapshot({ sessions: [
    session({ sid: "11111111-aaaa-bbbb", name: "demo-chat", label: "demo-chat", state: "idle", subagents: [sub("done0000x", false, { desc: "tidy up" }), sub("act00000x", true, { desc: "map the repo" })] }),
    session({ sid: "22222222-bbbb", name: "busy-chat", label: "busy-chat", title: "Big", state: "busy", pid: 456, subagents: [sub("idl00000x", false, { phase: "idle", desc: "stalled one" }), sub("cls00000x", false, { phase: "closed", desc: "cut off" })] }),
    session({ sid: "33333333-cccc", name: "quiet", label: "quiet", title: "Quiet", state: "idle", subagents: [] }),
    session({ sid: "44444444-dddd", name: "fourth", label: "fourth", title: "Fourth", state: "idle", subagents: [] }),
  ] });
  const tile = () => screen.getByRole("button", { name: "Open the Agents view" });
  const agents = () => screen.getByRole("region", { name: "Agents" });

  it("the Agents tile lists up to 3 main agents, working first, with +k running and +N more chats", () => {
    renderWith(data());
    const items = [...tile().querySelectorAll("li")];
    expect(items.map((i) => i.getAttribute("data-state"))).toEqual(["active", "idle", "idle", null]);      // the last item is the "+N more chats" line
    expect(items[0]).toHaveTextContent("busy-chat");
    expect(items[1]).toHaveTextContent("+1 running");
    expect(items[3]).toHaveTextContent("+1 more chats");
  });

  it("clicking the tile (and Enter) shows the agents view in place of the chat list", async () => {
    const user = renderWith(data());
    await user.click(tile());
    expect(agents()).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /demo-chat · Fix the thing/ })).not.toBeInTheDocument();
    await user.click(within(agents()).getByRole("radio", { name: "Chats" }));
    expect(screen.queryByRole("region", { name: "Agents" })).not.toBeInTheDocument();
    tile().focus();
    await user.keyboard("{Enter}");
    expect(agents()).toBeInTheDocument();
  });

  it("Esc and g return to the chats; A toggles", async () => {
    const user = renderWith(data());
    await user.keyboard("A");
    expect(agents()).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Agents" })).not.toBeInTheDocument();
    await user.keyboard("A");
    await user.keyboard("g");
    expect(screen.queryByRole("region", { name: "Agents" })).not.toBeInTheDocument();
  });

  it("agent cards carry the session id and pid buttons; subagent cards the state tag, code and a parent link", async () => {
    const user = renderWith(data());
    await user.click(tile());
    const main = within(agents()).getAllByText("busy-chat")[0].closest("[data-role=main]") as HTMLElement;
    expect(main).toHaveAttribute("data-state", "active");
    await user.click(within(main).getByText("#22222222"));
    expect(await navigator.clipboard.readText()).toBe("22222222-bbbb");
    await user.click(within(main).getByText("pid 456"));
    expect(await navigator.clipboard.readText()).toBe("456");
    const list = within(agents()).getByRole("list", { name: "Subagents of busy-chat" });
    const cards = within(list).getAllByRole("listitem");
    expect(cards.map((c) => c.getAttribute("data-state"))).toEqual(["idle", "closed"]);
    expect(cards[1]).toHaveTextContent("⊘ closed");
    expect(within(cards[1]).getByText("#cls0000")).toBeInTheDocument();
    expect(within(cards[1]).getByRole("button", { name: /busy-chat/ })).toBeInTheDocument();
    expect(within(agents()).getAllByText("no subagents").length).toBe(2);
  });

  it("the filter buttons carry counts; picking one narrows the cards; the page filter text applies; empty shows Clear", async () => {
    const user = renderWith(data());
    await user.click(tile());
    expect(within(agents()).getByRole("button", { name: "● active 1" })).toBeInTheDocument();
    expect(within(agents()).getByRole("button", { name: "⊘ closed 1" })).toBeInTheDocument();
    await user.click(within(agents()).getByRole("button", { name: "⊘ closed 1" }));
    expect(within(agents()).getByRole("button", { name: "⊘ closed 1" })).toHaveAttribute("aria-pressed", "true");
    expect(within(agents()).queryByText("tidy up")).not.toBeInTheDocument();
    expect(within(agents()).getByText("cut off")).toBeInTheDocument();
    await user.click(within(agents()).getByRole("button", { name: "All 4" }));
    await user.keyboard("/");
    await user.keyboard("map the");
    expect(within(agents()).getByText("map the repo")).toBeInTheDocument();
    expect(within(agents()).queryByText("cut off")).not.toBeInTheDocument();
    await user.keyboard("zzzz");
    expect(within(agents()).getByText("No agents match this filter")).toBeInTheDocument();
    await user.click(within(agents()).getByRole("button", { name: "Clear filter" }));
  });

  it("Open chat returns to the chats with that chat selected and its details shown", async () => {
    const user = renderWith(data());
    await user.click(tile());
    const main = within(agents()).getAllByText("demo-chat")[0].closest("[data-role=main]") as HTMLElement;
    await user.click(within(main).getByRole("button", { name: /Open chat/ }));
    expect(screen.queryByRole("region", { name: "Agents" })).not.toBeInTheDocument();
    expect(screen.getByText("SELECTED")).toBeInTheDocument();
    expect(screen.getByLabelText("Details of demo-chat")).toBeInTheDocument();
  });
});
