// Tests for the second design: render the real v2 App, feed it a snapshot through the fake EventSource and drive it
// with keys and clicks, checking what a person would see.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { session, snapshot } from "../test/fixtures";
import { FakeEventSource } from "../test/setup";
import { suggestLevels } from "../lib/settings";
import type { SystemAlert } from "../types";

const chatList = () => within(screen.getByRole("listbox", { name: "Chats" }));
const details = () => within(screen.getByLabelText("Chat details"));

function renderWith(data = snapshot()) {
  const user = userEvent.setup();
  render(<App />);
  act(() => FakeEventSource.last().push(data));
  return user;
}

describe("Aurora design", () => {
  it("shows a skeleton until the first snapshot", () => {
    render(<App />);
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  });

  it("renders the account, fleet health, usage limits and the live chats", () => {
    renderWith();
    expect(screen.getByRole("heading", { name: "test@example.com" })).toBeInTheDocument();
    expect(screen.getByLabelText("Overview")).toHaveTextContent("Threads");
    expect(screen.getByText("5-hour session")).toBeInTheDocument();
    expect(screen.getAllByText(/demo-chat/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Old chat")).not.toBeInTheDocument();            // archived is off at level 75
  });

  it("↓ moves, ⏎ opens the drawer, ⏎ copies the resume command, Esc closes it", async () => {
    const user = renderWith();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByText("SELECTED")).toBeInTheDocument();
    expect(screen.getByLabelText("Chat details")).toHaveAttribute("data-open");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe("cd ~/big && codex resume 22222222-bbbb");
    expect(await screen.findByText("Copied the resume command")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByText("NAVIGATE")).toBeInTheDocument();
    expect(screen.getByLabelText("Chat details")).not.toHaveAttribute("data-open");
  });

  it("shows where each chat runs, its model and a short session code", async () => {
    const user = renderWith();
    expect(screen.getAllByTitle(/Where it runs: terminal · CLI/).length).toBe(2);
    expect(screen.getByRole("button", { name: "Copy session id 22222222" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy session id 22222222" }));
    expect(await navigator.clipboard.readText()).toBe("22222222-bbbb");
  });

  it("the Running in chips filter the list", async () => {
    const data = snapshot();
    data.sessions[1] = { ...data.sessions[1], running_in: "IntelliJ · ACP plugin" };
    const user = renderWith(data);
    await user.click(screen.getByRole("button", { name: /^IntelliJ · ACP plugin/ }));
    expect(chatList().queryByText(/demo-chat/)).not.toBeInTheDocument();
    expect(chatList().getAllByText(/busy-chat/).length).toBeGreaterThan(0);
  });

  it("the Threads tile notes the subagents, and the drawer lists their codes", async () => {
    const data = snapshot();
    data.sessions[0] = session({ subagents: [
      { code: "acd8d62eb3e440f19", type: "Plan", desc: "Review the spec", model: "opus-5-5", ctx: "12.0k", ago: "1m", turns: 7, out: "2.5k", phase: "active", running: true },
      { code: "b7f1c0aa99887766", type: "Explore", desc: "Find the callers", model: "sonnet-5-5", ctx: "30.0k", ago: "9m", turns: 12, out: "8.1k", phase: "done", running: false },
    ] });
    const user = renderWith(data);
    const overview = screen.getByLabelText("Overview");
    expect(overview).toHaveTextContent("2 subagents · 1 running");                // the Threads tile notes the subagents
    expect(overview).toHaveTextContent("Cache hit");
    expect(screen.getAllByText(/2 subagents · 1 running/).length).toBeGreaterThan(1);       // the tile and the chat's own row
    await user.keyboard("{Enter}");
    expect(details().getByText("main agent")).toBeInTheDocument();
    expect(details().getByRole("button", { name: "Copy agent code acd8d62" })).toBeInTheDocument();
    expect(details().getByText("Find the callers")).toBeInTheDocument();
    expect(details().getByText("Explore")).toBeInTheDocument();
  });

  it("the Theme button opens a titled menu of every theme; m flips light and dark", async () => {
    const user = renderWith();
    expect(screen.queryByRole("group", { name: "Colour mode" })).not.toBeInTheDocument();     // no separate light/dark/auto strip
    await user.click(screen.getByRole("button", { name: "Switch theme" }));
    expect(screen.getByText("Switch theme", { selector: ".pop-h" })).toBeInTheDocument();
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(6);
    await user.click(screen.getByRole("menuitemradio", { name: /^Orchid/ }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    await user.keyboard("m");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    await user.click(screen.getByRole("button", { name: "Switch theme" }));
    await user.click(screen.getByRole("menuitemradio", { name: /^Auto/ }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("Full means full detail for live chats; archived chats are a separate switch", async () => {
    const user = renderWith();
    await user.click(screen.getByRole("button", { name: "full" }));
    expect(screen.queryByText("Old chat")).not.toBeInTheDocument();           // Full does NOT turn archived on
    expect(screen.getAllByText(/first prompt text/).length).toBeGreaterThan(0);  // but live chats now show their prompts
    await user.click(screen.getByRole("button", { name: "Archived" }));
    expect(await screen.findByText("Old chat")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "minimal" }));
    expect(screen.getByText("Old chat")).toBeInTheDocument();                  // the choice survives a level change
    expect(screen.queryByText("Usage limits")).not.toBeInTheDocument();
  });

  it("the a key toggles archived chats and the choice is remembered", async () => {
    const user = renderWith();
    await user.keyboard("a");
    expect(await screen.findByText("Old chat")).toBeInTheDocument();
    expect(localStorage.getItem("cust-codex-status.archived")).toBe("true");
  });

  it("⌘K opens the palette; typing filters; ⏎ runs the command (switch theme)", async () => {
    const user = renderWith();
    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    await user.keyboard("sunset{Enter}");
    expect(document.documentElement.getAttribute("data-theme")).toBe("sunset");
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  });

  it("the palette can jump to a chat", async () => {
    const user = renderWith();
    await user.keyboard("{Meta>}k{/Meta}");
    await user.keyboard("busy{Enter}");
    expect(screen.getByText("SELECTED")).toBeInTheDocument();
    expect(screen.getByLabelText("Chat details")).toHaveAttribute("data-open");
  });

  it("? opens the shortcuts sheet and Esc closes it", async () => {
    const user = renderWith();
    await user.keyboard("?");
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();
  });

  it("says so when the server has stopped", () => {
    render(<App />);
    act(() => {
      const es = FakeEventSource.last();
      for (let i = 0; i < 3; i++) es.onerror?.();
    });
    expect(screen.getByText("Can't reach the web server")).toBeInTheDocument();
  });

  it("needs attention: a compact summary; arrows switch; a click opens details with the app link", async () => {
    const data = snapshot();
    data.sessions.unshift(session({ sid: "w1", label: "waiter", name: "waiter", health: "AMBER", waiting: "Bash", why: ["waiting on a permission prompt (Bash)"],
      tips: ["answer it in VS Code · extension"], running_in: "VS Code · extension", folder: "~/api" }));
    const user = renderWith(data);
    const region = screen.getByRole("region", { name: "Needs attention" });
    expect(within(region).getByLabelText("2 need attention")).toBeInTheDocument();
    expect(within(region).getByText("waiter")).toBeInTheDocument();
    expect(within(region).getByText("Waiting for your approval: Bash")).toBeInTheDocument();
    expect(within(region).queryByRole("link", { name: /Open VS Code/ })).not.toBeInTheDocument();
    await user.click(within(region).getByRole("button", { name: /Waiting for your approval/ }));
    expect(within(region).getByRole("link", { name: /Open VS Code/ })).toHaveAttribute("href", "vscode://");
    expect(within(region).getByText("~/api")).toBeInTheDocument();
    await user.click(within(region).getByRole("button", { name: "Next item" }));
    expect(within(region).getByText("busy-chat")).toBeInTheDocument();
    expect(within(region).queryByText("~/api")).not.toBeInTheDocument();
  });

  it("needs attention: shows a usage limit near its cap", () => {
    renderWith(snapshot({ usage: { limits: [{ label: "weekly", pct: 91, resets: "2d", binding: true }], pools: [], cached_ago: "1m", stale: false } }));
    expect(within(screen.getByRole("region", { name: "Needs attention" })).getByText("weekly limit")).toBeInTheDocument();
  });

  // ---- alerts enhancement ---------------------------------------------------------------------------------------------

  const lastPost = () => {
    const calls = vi.mocked(fetch).mock.calls.filter(([u]) => u === "/api/config");
    return JSON.parse(String((calls[calls.length - 1]?.[1] as RequestInit | undefined)?.body ?? "null"));
  };

  it("footprint: a disk chip with the parts in its tooltip, a stacked bar without tiny parts, and housekeeping with a copy button", async () => {
    const data = snapshot();
    data.sessions[0] = session({
      files: { total_mb: 412, parts: [["temp", 100], ["transcript", 311], ["cache", 0.4]] },
      advice: [{ kind: "delete-scratch", text: "Delete 100 MB of scratch files", command: "rm -rf ~/scratch/demo" }, { kind: "long-transcript", text: "A long transcript: start a fresh chat", command: null }],
    });
    const user = renderWith(data);
    expect(screen.getAllByTitle(/On disk: temp 100 MB · transcript 311 MB · cache 0.4 MB/).length).toBe(1);
    expect(screen.getAllByText("412 MB").length).toBeGreaterThan(0);
    const bar = screen.getAllByRole("img", { name: /Disk by part/ })[0];
    expect(bar).toHaveAttribute("aria-label", "Disk by part: transcript 311 MB, temp 100 MB");     // biggest first, cache (<1 MB) hidden
    expect(screen.getAllByText("Delete 100 MB of scratch files").length).toBeGreaterThan(0);
    expect(screen.getAllByText("A long transcript: start a fresh chat").length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: "Copy housekeeping command" })[0]);
    expect(await navigator.clipboard.readText()).toBe("rm -rf ~/scratch/demo");
    expect(screen.getAllByRole("button", { name: "Copy housekeeping command" })).toHaveLength(1);       // none for the advice without a command
    await user.keyboard("{Enter}");
    expect(within(screen.getByLabelText("Chat details")).getByLabelText("Disk and housekeeping")).toHaveTextContent("Housekeeping");
  });

  it("context meter: the tick marks follow the chat's own amber and red levels", () => {
    const data = snapshot();
    data.sessions[0] = session({ ctx_amber_pct: 60, ctx_red_pct: 90, ctx_pct: 70 });
    renderWith(data);
    const ticks = [...screen.getAllByRole("meter", { name: "context window" })[0].querySelectorAll("u")];
    expect(ticks.map((u) => u.style.left)).toEqual(["60%", "90%"]);
    expect(ticks.map((u) => u.dataset.k)).toEqual(["amber", "red"]);
    expect(screen.getByText(/200k window at 85 \/ 95%, 1M at 60 \/ 90%/)).toBeInTheDocument();
  });

  it("window editor: a size list (1M recommended), 600k prefills 68/92, % and tokens are linked, edited rows survive a max change", async () => {
    const user = renderWith();
    await user.keyboard("{Enter}");
    const drawer = within(screen.getByLabelText("Chat details"));
    expect(drawer.getByText(/200\.0k window/)).toBeInTheDocument();
    expect(drawer.getByText(/a guess: 200k/)).toBeInTheDocument();
    expect(drawer.getByText(/alerts at/)).toHaveTextContent("alerts at 170.0k / 190.0k");
    expect(drawer.queryByRole("button", { name: "Reset to automatic" })).not.toBeInTheDocument();
    await user.click(drawer.getByRole("button", { name: "Change" }));
    const max = drawer.getByRole("combobox", { name: "Maximum context" }) as HTMLSelectElement;
    expect([...max.options].map((o) => o.textContent)).toEqual(["200k", "300k", "400k", "500k", "600k", "800k", "1M (recommended)", "1.5M", "2M", "Custom…"]);
    expect(max.value).toBe("200000");                                              // the chat's current size
    expect(drawer.getByLabelText("Amber percent")).toHaveValue("85");
    await user.selectOptions(max, "600000");
    expect(drawer.getByLabelText("Amber percent")).toHaveValue("68");
    expect(drawer.getByLabelText("Red percent")).toHaveValue("92");
    expect(drawer.getByLabelText("Amber tokens")).toHaveValue("408k");
    expect(drawer.getByLabelText("Red tokens")).toHaveValue("552k");
    expect(drawer.getByText("Alerts at 408k (amber) and 552k (red) of 600k.")).toBeInTheDocument();
    expect(drawer.getByText(/chat only/, { selector: ".note" })).toBeInTheDocument();
    expect(drawer.getByText("cust-codex-status --set-window 11111111 600k --levels 68 92")).toBeInTheDocument();
    await user.clear(drawer.getByLabelText("Amber percent")); await user.type(drawer.getByLabelText("Amber percent"), "50");
    expect(drawer.getByLabelText("Amber tokens")).toHaveValue("300k");              // % -> tokens
    await user.clear(drawer.getByLabelText("Red tokens")); await user.type(drawer.getByLabelText("Red tokens"), "480k");
    expect(drawer.getByLabelText("Red percent")).toHaveValue("80");                 // tokens -> %
    expect(drawer.getByText("cust-codex-status --set-window 11111111 600k --levels 50 80")).toBeInTheDocument();
    await user.selectOptions(max, "1000000");                                       // both rows were edited: keep THEIR percentages
    expect(drawer.getByLabelText("Amber percent")).toHaveValue("50");
    expect(drawer.getByLabelText("Amber tokens")).toHaveValue("500k");
    await user.click(drawer.getByRole("button", { name: /Use suggested \(60% \/ 90%\)/ }));
    expect(drawer.getByLabelText("Amber percent")).toHaveValue("60");
    await user.selectOptions(max, "800000");                                        // not edited any more: re-suggest
    expect(drawer.getByLabelText("Amber percent")).toHaveValue(String(suggestLevels(800_000)[0]));
  });

  it("window editor: bad levels or tokens block Apply; Apply posts this chat only", async () => {
    const user = renderWith();
    await user.keyboard("{Enter}");
    const drawer = within(screen.getByLabelText("Chat details"));
    await user.click(drawer.getByRole("button", { name: "Change" }));
    await user.selectOptions(drawer.getByRole("combobox", { name: "Maximum context" }), "600000");
    await user.clear(drawer.getByLabelText("Amber percent")); await user.type(drawer.getByLabelText("Amber percent"), "95");
    expect(drawer.getByRole("alert")).toHaveTextContent(/below red/);
    expect(drawer.getByRole("button", { name: "Apply to this chat" })).toBeDisabled();
    await user.clear(drawer.getByLabelText("Amber percent")); await user.type(drawer.getByLabelText("Amber percent"), "70");
    await user.clear(drawer.getByLabelText("Red tokens")); await user.type(drawer.getByLabelText("Red tokens"), "900k");
    expect(drawer.getByRole("alert")).toHaveTextContent(/above the maximum/);
    expect(drawer.getByRole("button", { name: "Apply to this chat" })).toBeDisabled();
    await user.clear(drawer.getByLabelText("Red percent")); await user.type(drawer.getByLabelText("Red percent"), "92");
    await user.click(drawer.getByRole("button", { name: "Apply to this chat" }));
    expect(lastPost()).toEqual({ chat: { sid: "11111111-aaaa", window: "600k", amber: 70, red: 92 } });
    expect(await screen.findByText("Window set for this chat")).toBeInTheDocument();
    expect(drawer.queryByLabelText("Maximum context")).not.toBeInTheDocument();
  });

  it("window editor: Custom… takes a size, a failed write shows the error, Reset only exists for a per-chat window", async () => {
    const data = snapshot();
    data.sessions[0] = session({ window_source: "chat", window: "750.0k", window_tokens: 750_000, ctx_amber: "510.0k", ctx_red: "690.0k", ctx_amber_pct: 68, ctx_red_pct: 92, levels_custom: true });
    const user = renderWith(data);
    await user.keyboard("{Enter}");
    const drawer = within(screen.getByLabelText("Chat details"));
    expect(drawer.getByText("cust-codex-status --clear-window 11111111")).toBeInTheDocument();
    await user.click(drawer.getByRole("button", { name: "Change" }));
    expect(drawer.getByRole("combobox", { name: "Maximum context" })).toHaveValue("custom");     // 750k is not in the list
    expect(drawer.getByLabelText("Custom size")).toHaveValue("750k");
    await user.clear(drawer.getByLabelText("Custom size")); await user.type(drawer.getByLabelText("Custom size"), "5k");
    expect(drawer.getByRole("alert")).toHaveTextContent(/10k to 10M/);
    expect(drawer.getByRole("button", { name: "Apply to this chat" })).toBeDisabled();
    await user.clear(drawer.getByLabelText("Custom size")); await user.type(drawer.getByLabelText("Custom size"), "1m");
    vi.mocked(fetch).mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ error: "read-only" }), { status: 403 })));
    await user.click(drawer.getByRole("button", { name: "Apply to this chat" }));
    expect(await drawer.findByText(/Not saved: read-only/)).toBeInTheDocument();
    await user.click(drawer.getByRole("button", { name: "Reset to automatic" }));
    expect(lastPost()).toEqual({ chat: { sid: "11111111-aaaa", clear: true } });
    expect(await screen.findByText("Back to automatic for this chat")).toBeInTheDocument();
  });

  it("needs attention: a guessed window offers the compact editor with 1M preselected; Apply writes it, Copy gives the command", async () => {
    const data = snapshot();
    data.sessions[1] = { ...data.sessions[1], window_offer: { sid: "22222222-bbbb", size: "1m", amber: 60, red: 90, command: "cust-codex-status --set-window 22222222 1m --levels 60 90" } };
    const user = renderWith(data);
    const region = screen.getByRole("region", { name: "Needs attention" });
    await user.click(within(region).getByRole("button", { name: /Context 89%/ }));
    expect(within(region).getByText(/judged against an assumed 200k window/)).toBeInTheDocument();
    const max = within(region).getByRole("combobox", { name: "Maximum context" });
    expect(max).toHaveValue("1000000");
    expect(within(region).getByText("Alerts at 600k (amber) and 900k (red) of 1M.")).toBeInTheDocument();
    expect(within(region).queryByLabelText("Amber percent")).not.toBeInTheDocument();       // behind "Edit thresholds"
    await user.selectOptions(max, "600000");
    expect(within(region).getByText("Alerts at 408k (amber) and 552k (red) of 600k.")).toBeInTheDocument();
    await user.selectOptions(max, "1000000");
    await user.click(within(region).getByRole("button", { name: "Edit thresholds" }));
    expect(within(region).getByLabelText("Amber percent")).toHaveValue("60");
    expect(within(region).getByLabelText("Red tokens")).toHaveValue("900k");
    await user.click(within(region).getByRole("button", { name: "Copy window command" }));
    expect(await navigator.clipboard.readText()).toBe("cust-codex-status --set-window 22222222 1m --levels 60 90");
    await user.click(within(region).getByRole("button", { name: "Apply to this chat" }));
    expect(lastPost()).toEqual({ chat: { sid: "22222222-bbbb", window: "1m", amber: 60, red: 90 } });
  });

  describe("machine band", () => {
    const mem = (level: "AMBER" | "RED" = "AMBER"): SystemAlert => ({
      key: "system:memory", kind: "memory", level, title: "Memory pressure", headline: "Live chats hold 5.2 GB of RAM", tips: ["Close idle chats"],
      culprits: [{ sid: "22222222-bbbb", label: "busy-chat", mem_mb: 5200 }],
    });
    const disk: SystemAlert = {
      key: "system:disk", kind: "disk", level: "AMBER", title: "Disk space", headline: "Only 4 GB free", tips: [], culprits: [],
      reclaim_mb: 1200, reclaim_chats: ["33333333-cccc"],
    };

    it("renders nothing without machine alerts, and does not touch the chat tiles or the attention card", () => {
      renderWith();
      expect(screen.queryByRole("region", { name: "Machine alerts" })).not.toBeInTheDocument();
    });

    it("is its own band: counted apart from the chats and kept out of Needs attention", () => {
      renderWith(snapshot({ system: [mem(), disk] }));
      const band = screen.getByRole("region", { name: "Machine alerts" });
      expect(within(band).getByLabelText("2 machine alerts")).toBeInTheDocument();
      expect(within(band).getByText("Live chats hold 5.2 GB of RAM")).toBeInTheDocument();
      expect(within(screen.getByRole("region", { name: "Needs attention" })).getByLabelText("1 needs attention")).toBeInTheDocument();
      expect(screen.getByLabelText("Overview")).toHaveTextContent("1 ok1 amber0 red");
    });

    it("Snooze minimises to a chip, the chip expands again, and the choice survives a reload", async () => {
      const user = renderWith(snapshot({ system: [mem()] }));
      const band = screen.getByRole("region", { name: "Machine alerts" });
      await user.click(within(band).getByRole("button", { name: "Snooze" }));
      expect(within(band).queryByRole("button", { name: "Snooze" })).not.toBeInTheDocument();
      const chip = within(band).getByRole("button", { name: /Show Memory pressure/ });
      expect(chip).toHaveTextContent("Live chats hold 5.2 GB of RAM");
      expect(localStorage.getItem("cust-codex-status.snoozed")).toContain("system:memory");
      await user.click(chip);
      expect(within(band).getByRole("button", { name: "Snooze" })).toBeInTheDocument();
      expect(localStorage.getItem("cust-codex-status.snoozed")).not.toContain("system:memory");
    });

    it("opens again when AMBER becomes RED and then stays open; a cleared alert is forgotten", async () => {
      const user = renderWith(snapshot({ system: [mem()] }));
      await user.click(screen.getByRole("button", { name: "Snooze" }));
      expect(screen.queryByRole("button", { name: "Snooze" })).not.toBeInTheDocument();
      act(() => FakeEventSource.last().push(snapshot({ system: [mem("RED")] })));
      expect(screen.getByRole("button", { name: "Snooze" })).toBeInTheDocument();
      act(() => FakeEventSource.last().push(snapshot({ system: [mem("AMBER")] })));
      expect(screen.getByRole("button", { name: "Snooze" })).toBeInTheDocument();           // back to AMBER: still expanded
      await user.click(screen.getByRole("button", { name: "Snooze" }));
      act(() => FakeEventSource.last().push(snapshot({ system: [] })));
      expect(screen.queryByRole("region", { name: "Machine alerts" })).not.toBeInTheDocument();
      expect(localStorage.getItem("cust-codex-status.snoozed") ?? "{}").not.toContain("system:memory");
    });

    it("a culprit chip opens that chat in the drawer", async () => {
      const user = renderWith(snapshot({ system: [mem()] }));
      await user.click(within(screen.getByRole("region", { name: "Machine alerts" })).getByRole("button", { name: /busy-chat.*5,200 MB/ }));
      expect(screen.getByLabelText("Chat details")).toHaveAttribute("data-open");
      expect(within(screen.getByLabelText("Chat details")).getByRole("heading", { name: "busy-chat" })).toBeInTheDocument();
    });

    it("disk: says what could be freed and the button shows the archived chats and opens the first", async () => {
      const user = renderWith(snapshot({ system: [disk] }));
      const band = screen.getByRole("region", { name: "Machine alerts" });
      expect(within(band).getByText("1,200 MB could be freed from 1 ended chat")).toBeInTheDocument();
      expect(screen.queryByText("Old chat")).not.toBeInTheDocument();
      await user.click(within(band).getByRole("button", { name: /Show those chats/ }));
      expect(await screen.findAllByText("Old chat")).not.toHaveLength(0);
      expect(within(screen.getByLabelText("Chat details")).getByRole("heading", { name: "Old chat" })).toBeInTheDocument();
    });
  });

  it("the header says the page is read-only data and what the one exception is", () => {
    renderWith();
    const badge = screen.getByText("read-only data");
    expect(badge).toHaveAttribute("title", expect.stringContaining("single chat"));
  });

  describe("agents", () => {
    const sub = (code: string, running: boolean, extra = {}) => ({ code, type: "Plan", desc: `job ${code.slice(0, 3)}`, model: "opus-5-5", ctx: "12.0k", ago: "1m", turns: 7, out: "2.5k", phase: (running ? "active" : "done") as "active" | "done", running, ...extra });
    const withAgents = () => {
      const data = snapshot();
      data.sessions[0] = session({ first_prompt: "first prompt text", subagents: [sub("aaaaaaa1111", false), sub("bbbbbbb2222", true), sub("ccccccc3333", true, { type: "Explore" }), sub("ddddddd4444", false), sub("eeeeeee5555", false), sub("fffffff6666", false)] });
      data.sessions[1] = session({ sid: "22222222-bbbb", name: "busy-chat", label: "busy-chat", state: "busy", pid: 4242, waiting: "Bash" });
      return data;
    };

    it("rows show a pid chip that copies the pid without opening the drawer", async () => {
      const user = renderWith(withAgents());
      expect(chatList().getByRole("button", { name: "Copy pid 123" })).toBeInTheDocument();
      await user.click(chatList().getByRole("button", { name: "Copy pid 4242" }));
      expect(await navigator.clipboard.readText()).toBe("4242");
      expect(await screen.findByText("Copied the pid")).toBeInTheDocument();
      expect(screen.getByLabelText("Chat details")).not.toHaveAttribute("data-open");
    });

    it("an ended chat has no pid chip", async () => {
      const user = renderWith();
      await user.keyboard("a");
      const old = (await chatList().findAllByText("Old chat"))[0].closest(".row") as HTMLElement;
      expect(within(old).queryByRole("button", { name: /Copy pid/ })).not.toBeInTheDocument();
    });

    const header = (name = /^subagents \(/) => chatList().getAllByRole("button", { name })[0];
    const ph = (code: string, phase: "active" | "idle" | "done" | "closed", extra = {}) => sub(code, phase === "active", { phase, ...extra });
    const withPhases = (phases: ("active" | "idle" | "done" | "closed")[]) => {
      const data = snapshot();
      data.sessions[0] = session({ subagents: phases.map((p, i) => ph(`code${i}${"abcdefgh"[i]}${i}${i}${i}`, p)) });
      return data;
    };
    const lineStates = () => Array.from(chatList().getAllByLabelText("Subagents")[0].querySelectorAll(".subline")).map((l) => l.getAttribute("data-state"));

    it("the long list starts folded: the header counts every state with text, and a click opens all lines", async () => {
      const user = renderWith(withAgents());                                    // 2 active + 4 done: 6 is long, so it starts folded
      expect(header()).toHaveAttribute("aria-expanded", "false");
      expect(header()).toHaveTextContent("subagents (6)");
      expect(header()).toHaveTextContent("2 active");
      expect(header()).toHaveTextContent("4 done");
      expect(header()).not.toHaveTextContent("idle");                           // only the non-zero states
      expect(chatList().queryByLabelText("Subagents")).not.toBeInTheDocument();
      await user.click(header());
      expect(header()).toHaveAttribute("aria-expanded", "true");
      expect(lineStates()).toEqual(["active", "active", "done", "done", "done", "done"]);       // all of them, active first, no cap
      expect(screen.getByLabelText("Chat details")).not.toHaveAttribute("data-open");           // the click did not pick the row
      expect(chatList().queryByText(/\+\d+ more/)).not.toBeInTheDocument();
    });

    it("subagent lines show code, type, description, stats and a state tag", async () => {
      const user = renderWith(withAgents());
      await user.click(header());
      const lines = Array.from(chatList().getAllByLabelText("Subagents")[0].querySelectorAll(".subline"));
      expect(lines[0]).toHaveTextContent("Plan");
      expect(lines[0]).toHaveTextContent("#bbbbbbb");
      expect(lines[0]).toHaveTextContent("job bbb");
      expect(lines[0]).toHaveTextContent("active");
      expect(lines[0]).toHaveTextContent("opus-5-5 · 12.0k · 7t · 2.5k · 1m");
      expect(within(lines[0] as HTMLElement).queryByText(/pid/)).not.toBeInTheDocument();
      await user.click(chatList().getByRole("button", { name: "Copy agent code bbbbbbb" }));
      expect(await navigator.clipboard.readText()).toBe("bbbbbbb2222");
      expect(screen.getByLabelText("Chat details")).not.toHaveAttribute("data-open");
    });

    it("starts open for a short list with something going on, folded when all are done", () => {
      renderWith(withPhases(["done", "active", "done"]));
      expect(header()).toHaveAttribute("aria-expanded", "true");
      expect(lineStates()).toEqual(["active", "done", "done"]);
    });

    it("starts folded when every subagent is done or closed", () => {
      renderWith(withPhases(["done", "closed"]));
      expect(header()).toHaveAttribute("aria-expanded", "false");
    });

    it("toggling hides and shows the lines (the fold plays, then they unmount)", async () => {
      const user = renderWith(withPhases(["active", "idle"]));
      expect(lineStates()).toEqual(["active", "idle"]);
      await user.click(header());
      expect(header()).toHaveAttribute("aria-expanded", "false");
      await waitFor(() => expect(chatList().queryByLabelText("Subagents")).not.toBeInTheDocument());
      await user.click(header());
      expect(lineStates()).toEqual(["active", "idle"]);
    });

    it("each state shows its tag, data-state and dimming", () => {
      renderWith(withPhases(["active", "idle", "done", "closed"]));
      const lines = Array.from(chatList().getAllByLabelText("Subagents")[0].querySelectorAll(".subline"));
      expect(lines.map((l) => l.getAttribute("data-state"))).toEqual(["active", "idle", "done", "closed"]);
      expect(lines.map((l) => l.querySelector(".sub-tag")?.textContent?.replace(/^\S+\s/, ""))).toEqual(["active", "idle", "done", "closed"]);
      expect(lines.map((l) => l.classList.contains("dim"))).toEqual([false, false, true, true]);
      expect(lines[3].querySelector(".sub-tag")).toHaveAttribute("title", expect.stringContaining("chat ended"));
      expect(header()).toHaveTextContent("1 active");
      expect(header()).toHaveTextContent("1 idle");
      expect(header()).toHaveTextContent("1 done");
      expect(header()).toHaveTextContent("1 closed");
    });

    it("the choice survives a new snapshot and a re-sort of the rows", async () => {
      const data = withPhases(["active", "done"]);
      const user = renderWith(data);
      await user.click(header());                                                // fold the (initially open) list of demo-chat
      await waitFor(() => expect(chatList().queryByLabelText("Subagents")).not.toBeInTheDocument());
      const next = snapshot();
      next.sessions = [next.sessions[1], { ...data.sessions[0], subagents: [...data.sessions[0].subagents, ph("zzzzzzz9999", "active")] }, next.sessions[2]];   // swapped places + a new subagent
      act(() => FakeEventSource.last().push(next));
      expect(chatList().queryByLabelText("Subagents")).not.toBeInTheDocument();  // still folded
      expect(header()).toHaveTextContent("subagents (3)");
    });

    it("a folded list stays folded after a trip to the Agents view and back", async () => {
      const user = renderWith(withPhases(["active", "done"]));
      await user.click(header());                                                // fold the (initially open) list
      await waitFor(() => expect(chatList().queryByLabelText("Subagents")).not.toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Open the Agents view" }));
      expect(screen.queryByRole("listbox", { name: "Chats" })).not.toBeInTheDocument();   // the chat list is gone
      await user.click(within(screen.getByRole("group", { name: "Section" })).getByRole("button", { name: "chats" }));
      expect(chatList().queryByLabelText("Subagents")).not.toBeInTheDocument();  // and its folded state came back with it
    });

    it("the drawer keeps its own subagent cards and words their status with the four states", async () => {
      const user = renderWith(withAgents());
      await user.keyboard("{Enter}");
      const d = details();
      expect(d.getAllByText(/^(active|idle|done|closed) · /).length).toBeGreaterThan(0);        // not just "running" / "done"
      expect(screen.getByLabelText("Chat details")).toHaveAttribute("data-open");
    });

    it("prompts in a row are clamped to one line", async () => {
      const user = renderWith(withAgents());
      await user.click(screen.getByRole("button", { name: "full" }));
      expect(chatList().getAllByText(/first prompt text/)[0].closest(".prompt")).toHaveClass("one");
    });
  });

  describe("agents view", () => {
    const sub = (code: string, phase: "active" | "idle" | "done" | "closed", extra = {}) => ({ code, type: "Plan", desc: `job ${code.slice(0, 3)}`, model: "opus-5-5", ctx: "12.0k", ago: "1m", turns: 7, out: "2.5k", phase, running: phase === "active", ...extra });
    const data = () => {
      const d = snapshot();
      d.sessions[0] = session({ subagents: [sub("aaaaaaa1111", "active"), sub("bbbbbbb2222", "idle", { type: "Explore" }), sub("ccccccc3333", "done"), sub("ddddddd4444", "closed")] });
      d.sessions[1] = session({ sid: "22222222-bbbb", name: "busy-chat", label: "busy-chat", state: "busy", pid: 4242, subagents: [] });
      return d;
    };
    const tile = () => screen.getByRole("button", { name: "Open the Agents view" });
    const sections = () => ({ chats: screen.queryByRole("listbox", { name: "Chats" }), agents: screen.queryByRole("region", { name: "Agents" }) });
    const view = () => within(screen.getByRole("region", { name: "Agents" }));

    it("clicking the tile (and Enter on it) shows the agents view instead of the chat list", async () => {
      const user = renderWith(data());
      expect(sections().chats).toBeInTheDocument();
      await user.click(tile());
      expect(sections().chats).not.toBeInTheDocument();
      expect(sections().agents).toBeInTheDocument();
      await user.click(view().getByRole("button", { name: "chats" }));
      expect(sections().chats).toBeInTheDocument();
      tile().focus();
      await user.keyboard("{Enter}");
      expect(sections().agents).toBeInTheDocument();
      expect(screen.getByLabelText("Chat details")).not.toHaveAttribute("data-open");
    });

    it("the Chats | Agents switch and Esc go back to the chat list", async () => {
      const user = renderWith(data());
      await user.click(within(screen.getByRole("region", { name: "Chats" })).getByRole("button", { name: "agents" }));
      expect(sections().agents).toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(sections().chats).toBeInTheDocument();
    });

    it("shows one agent card per live chat with session and pid chips, and subagent cards with tags and a parent link", async () => {
      const user = renderWith(data());
      await user.click(tile());
      const cards = view().getAllByLabelText(/^Agent /);
      expect(cards).toHaveLength(2);                                            // two live chats (the archived one is not listed)
      const first = within(cards[1]);                                           // busy-chat (working) is listed before idle demo-chat
      expect(first.getByRole("button", { name: /^Copy session id/ })).toBeInTheDocument();
      expect(first.getByRole("button", { name: /^Copy pid/ })).toBeInTheDocument();
      expect(within(cards[0]).getByText("no subagents")).toBeInTheDocument();
      const subs = Array.from(cards[1].querySelectorAll(".scard"));
      expect(subs.map((c) => c.getAttribute("data-state"))).toEqual(["active", "idle", "done", "closed"]);
      expect(subs.map((c) => c.querySelector(".sub-tag")?.textContent?.replace(/^\S+\s/, ""))).toEqual(["active", "idle", "done", "closed"]);
      expect(subs.map((c) => c.classList.contains("dim"))).toEqual([false, false, true, true]);
      expect(subs[0]).toHaveTextContent("opus-5-5 · 12.0k · 7t · 2.5k · 1m");
      expect(within(subs[0] as HTMLElement).getByRole("button", { name: "Copy agent code aaaaaaa" })).toBeInTheDocument();
      await user.click(within(subs[0] as HTMLElement).getByRole("button", { name: "Copy agent code aaaaaaa" }));
      expect(await navigator.clipboard.readText()).toBe("aaaaaaa1111");
      expect(within(subs[0] as HTMLElement).getByRole("button", { name: "Open chat demo-chat" })).toHaveTextContent("↗ demo-chat");
    });

    it("the filter pills show totals and filter the cards; the text filter applies too", async () => {
      const user = renderWith(data());
      await user.type(screen.getByLabelText("Filter chats"), "demo");
      await user.click(tile());
      const pills = view().getByRole("group", { name: "Subagent state" });
      expect(within(pills).getByRole("button", { name: /active/ })).toHaveTextContent("1");
      expect(within(pills).getByRole("button", { name: /closed/ })).toHaveTextContent("1");
      expect(view().getAllByLabelText(/^Agent /)).toHaveLength(1);                // the text filter dropped busy-chat
      await user.click(within(pills).getByRole("button", { name: /idle/ }));
      expect(within(pills).getByRole("button", { name: /idle/ })).toHaveAttribute("aria-pressed", "true");
      const subs = Array.from(view().getAllByLabelText(/^Agent /)[0].querySelectorAll(".scard"));
      expect(subs).toHaveLength(1);
      expect(subs[0]).toHaveAttribute("data-state", "idle");
    });

    it("says so when nothing matches, and the clear button brings the cards back", async () => {
      const user = renderWith({ ...data() });
      await user.click(tile());
      const pills = view().getByRole("group", { name: "Subagent state" });
      await user.click(within(pills).getByRole("button", { name: /closed/ }));
      await user.click(within(pills).getByRole("button", { name: /closed/ }));   // toggles back to all
      const d = data();
      d.sessions[0] = session({ subagents: [] });
      act(() => FakeEventSource.last().push(d));
      await user.click(within(pills).getByRole("button", { name: /closed/ }));
      expect(view().getByText("No agents match this filter.")).toBeInTheDocument();
      await user.click(view().getByRole("button", { name: "Clear the filter" }));
      expect(view().getAllByLabelText(/^Agent /)).toHaveLength(2);
    });

    it("Open chat returns to the chat list with that chat picked", async () => {
      const user = renderWith(data());
      await user.click(tile());
      await user.click(view().getAllByRole("button", { name: /^Open chat busy-chat$/ })[0]);
      expect(sections().chats).toBeInTheDocument();
      expect(screen.getByLabelText("Chat details")).toHaveAttribute("data-open");
      expect(within(screen.getByLabelText("Chat details")).getByRole("heading", { name: "busy-chat" })).toBeInTheDocument();
    });
  });
});
