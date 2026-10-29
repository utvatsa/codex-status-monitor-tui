// The second design's page. Same data (useSnapshot), same state machine (uiReducer) and same keys as the first design;
// only the presentation differs. This component derives what to show and wires keys, palette commands and clicks to actions.
import { flushSync } from "react-dom";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useHotkeys, type Keymap } from "../hooks/useHotkeys";
import { useNow } from "../hooks/useNow";
import { requestRefresh, useSnapshot } from "../hooks/useSnapshot";
import { nextTheme, THEMES, useTheme, type ThemeId } from "../hooks/useTheme";
import { copyText } from "../lib/clipboard";
import { storage } from "../lib/storage";
import { LEVEL_REPS, VIEWS } from "../lib/view";
import { effectiveFlags, initialUi, uiReducer } from "../state/ui";
import type { Session } from "../types";
import { Chats } from "./Chats";
import { useSubOpen } from "./Agents";
import { AgentsView } from "./AgentsView";
import type { MainView } from "../lib/agents";
import { Drawer } from "./Drawer";
import { Header } from "./Header";
import { Hero } from "./Hero";
import { Help, Palette, type Command } from "./Palette";
import { I, Kbd, ToastProvider, useToast } from "./parts";
import { effectiveMode, modelLabel } from "./derive";
import { useSeries } from "./series";

const matches = (x: Session, q: string) =>
  !q || [x.label, x.title, x.folder, x.sid, x.model, modelLabel(x.model), x.running_in].some((v) => (v || "").toLowerCase().includes(q));

/** Run a change that restyles the whole page inside a cross-fade, where the browser supports View Transitions. */
function smooth(change: () => void) {
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (d.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) d.startViewTransition(() => flushSync(change));
  else change();
}

function Page() {
  const start = useMemo(() => {
    const q = new URLSearchParams(location.search);
    const saved = Number(storage.get("level"));
    const fromUrl = q.has("level") ? Number(q.get("level")) : NaN;
    const level = !Number.isNaN(fromUrl) ? fromUrl : storage.get("level") !== null && !Number.isNaN(saved) ? saved : null;
    return { ui: { ...initialUi, level, arcPrompt: storage.get("arcPrompt") !== "false" }, theme: q.get("theme"), arc: storage.get("archived") === "true" };
  }, []);
  const { snapshot, connection } = useSnapshot();
  const [ui, dispatch] = useReducer(uiReducer, start.ui);
  const [theme, setThemeRaw] = useTheme(start.theme);
  const setTheme = useCallback((t: ThemeId) => smooth(() => setThemeRaw(t)), [setThemeRaw]);
  const now = useNow(1000);
  const toast = useToast();
  const series = useSeries(snapshot);
  const search = useRef<HTMLInputElement>(null);
  const askedArc = useRef(false);
  const subs = useSubOpen();                                           // per-chat fold state of the subagent lists: kept here so it survives the Agents view
  const [mainView, setMainView] = useState<MainView>("chats");       // the chat list, or the agent cards (opened from the top Agents tile); not saved
  const [palette, setPalette] = useReducer((_: boolean, v: boolean) => v, false);

  // Archived chats are their own switch, not part of the detail level: "Full" means full detail for the LIVE chats.
  const [arcOn, setArcOn] = useState(start.arc);
  useEffect(() => { storage.set("archived", String(arcOn)); }, [arcOn]);
  const toggleArc = useCallback(() => setArcOn((v) => !v), []);
  const f = { ...effectiveFlags(ui, snapshot?.view.level ?? 75), showArc: arcOn, arcPrompt: ui.arcPrompt, allSubagents: ui.allSubagents };
  const q = ui.query.trim().toLowerCase();
  const sessions = snapshot?.sessions ?? [];
  const live = snapshot?.view.show_live ? sessions.filter((x) => x.active && matches(x, q)) : [];
  const archived = f.showArc ? sessions.filter((x) => !x.active && matches(x, q)) : [];
  const items = useMemo(() => [...live, ...archived], [live, archived]);
  const ids = items.map((x) => x.sid);
  const idKey = ids.join(",");
  const current = items.find((x) => x.sid === ui.cursor);

  useEffect(() => { dispatch({ type: "sync", ids: idKey ? idKey.split(",") : [] }); }, [idKey]);
  useEffect(() => {
    if (ui.level !== null) storage.set("level", String(ui.level));
    storage.set("arcPrompt", String(ui.arcPrompt));
  }, [ui.level, ui.arcPrompt]);
  useEffect(() => {
    if (snapshot && f.showArc && !snapshot.view.has_arc && !askedArc.current) { askedArc.current = true; requestRefresh(true); }
  }, [snapshot, f.showArc]);
  useEffect(() => {
    if (ui.cursor) document.querySelector(`[data-sid="${ui.cursor}"]`)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [ui.cursor, ui.selected]);

  const copy = useCallback(async (text: string, what: string) => {
    toast((await copyText(text)) ? `Copied the ${what}` : "Copy failed: select the text and press ⌘C");
  }, [toast]);
  const refresh = useCallback(() => { requestRefresh(f.showArc); toast("Reading again…"); }, [f.showArc, toast]);

  /** Flip between a light and a dark look (from "auto" it flips whatever the system currently shows). */
  const flipMode = useCallback(() => {
    const next = effectiveMode(theme) === "dark" ? "light" : "dark";
    setTheme(next);
    toast(`${next === "dark" ? "Dark" : "Light"} mode`);
  }, [theme, setTheme, toast]);

  const noOverlay = !ui.helpOpen && !palette;
  const keys: Keymap = !noOverlay ? {} : {
    ArrowDown: () => dispatch({ type: "move", delta: 1, ids }), ArrowUp: () => dispatch({ type: "move", delta: -1, ids }),
    j: () => dispatch({ type: "move", delta: 1, ids }), k: () => dispatch({ type: "move", delta: -1, ids }),
    g: () => dispatch({ type: "jump", to: "first", ids }), G: () => dispatch({ type: "jump", to: "last", ids }),
    Enter: () => { if (!current) return; if (!ui.selected) dispatch({ type: "select" }); else copy(current.resume, "resume command"); },
    y: () => current && copy(current.resume, "resume command"),
    i: () => current && copy(current.sid, "session id"),
    f: () => current && copy(current.clean, "fresh-chat command"),
    Escape: () => (mainView === "agents" && !ui.selected ? setMainView("chats") : dispatch({ type: "back" })), b: () => dispatch({ type: "back" }),
    "+": () => dispatch({ type: "stepLevel", delta: 1, current: f.level }), "=": () => dispatch({ type: "stepLevel", delta: 1, current: f.level }),
    "-": () => dispatch({ type: "stepLevel", delta: -1, current: f.level }), _: () => dispatch({ type: "stepLevel", delta: -1, current: f.level }),
    a: toggleArc,
    c: () => dispatch({ type: "toggleFlag", flag: "compact", current: f.compact }),
    p: () => dispatch({ type: "toggleFlag", flag: "noPrompts", current: f.noPrompts }),
    v: () => dispatch({ type: "toggleFlag", flag: "verbose", current: f.verbose }),
    s: () => dispatch({ type: "toggle", key: "allSubagents" }), t: () => dispatch({ type: "toggle", key: "arcPrompt" }),
    u: () => dispatch({ type: "toggle", key: "showAccount" }), e: () => dispatch({ type: "expandAll", ids }),
    r: refresh, "/": () => search.current?.focus(), "?": () => dispatch({ type: "toggle", key: "helpOpen" }),
    d: () => { const t = nextTheme(theme); setTheme(t); toast(`Theme: ${THEMES.find((x) => x.id === t)?.label}`); },
    m: () => flipMode(),
    ...Object.fromEntries([1, 2, 3, 4, 5].map((k) => [String(k), () => dispatch({ type: "setLevel", level: LEVEL_REPS[k - 1] })])),
  };
  useHotkeys(keys, { onTypingEscape: (el) => { dispatch({ type: "setQuery", query: "" }); el.blur(); } });

  // ⌘K / Ctrl+K opens the palette from anywhere (useHotkeys skips keys with a modifier on purpose).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(!palette); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [palette]);

  const commands: Command[] = useMemo(() => [
    ...items.map((x, i): Command => ({ id: `chat-${x.sid}`, group: "Chats", title: `${x.name || x.label}${x.title && x.title !== (x.name || x.label) ? ` · ${x.title}` : ""}`, hint: i < 9 ? undefined : undefined, run: () => dispatch({ type: "pick", id: x.sid }) })),
    ...(current ? [
      { id: "copy-resume", group: "Selected chat", title: "Copy the resume command", hint: ["y"], run: () => copy(current.resume, "resume command") },
      { id: "copy-id", group: "Selected chat", title: "Copy the session id", hint: ["i"], run: () => copy(current.sid, "session id") },
      { id: "copy-clean", group: "Selected chat", title: "Copy the fresh-chat command", hint: ["f"], run: () => copy(current.clean, "fresh-chat command") },
    ] : []),
    ...VIEWS.map((v, i): Command => ({ id: `view-${v}`, group: "Detail level", title: `Show the ${v} view`, hint: [String(i + 1)], run: () => dispatch({ type: "setLevel", level: LEVEL_REPS[i] }) })),
    { id: "arc", group: "View", title: f.showArc ? "Hide archived chats" : "Show archived chats", hint: ["a"], run: toggleArc },
    { id: "prompts", group: "View", title: f.noPrompts ? "Show prompts" : "Hide prompts", hint: ["p"], run: () => dispatch({ type: "toggleFlag", flag: "noPrompts", current: f.noPrompts }) },
    { id: "compact", group: "View", title: f.compact ? "Use roomy rows" : "Use compact rows", hint: ["c"], run: () => dispatch({ type: "toggleFlag", flag: "compact", current: f.compact }) },
    { id: "expand", group: "View", title: "Expand or collapse every row", hint: ["e"], run: () => dispatch({ type: "expandAll", ids }) },
    { id: "account", group: "View", title: "Show or hide account details", hint: ["u"], run: () => dispatch({ type: "toggle", key: "showAccount" }) },
    { id: "mode-flip", group: "Colour mode", title: "Flip light / dark", hint: ["m"], run: flipMode },
    ...(["light", "dark", "auto"] as const).map((m): Command => ({ id: `mode-${m}`, group: "Colour mode", title: `Use ${m} mode`, run: () => setTheme(m) })),
    ...THEMES.filter((t) => !["light", "dark", "auto"].includes(t.id)).map((t): Command => ({ id: `theme-${t.id}`, group: "Colour palette", title: `Palette: ${t.label}`, run: () => setTheme(t.id) })),
    { id: "refresh", group: "Page", title: "Read again now", hint: ["r"], run: refresh },
    { id: "help", group: "Page", title: "Keyboard shortcuts", hint: ["?"], run: () => dispatch({ type: "toggle", key: "helpOpen" }) },
  ], [items, current, f.showArc, f.noPrompts, f.compact, ids, copy, refresh, setTheme, flipMode, toggleArc]);

  if (!snapshot) {
    return connection === "stopped" ? (
      <div className="down"><I name="plug" size={30} /><h1>Can't reach the web server</h1>
        <p>Start it again with <code>cust-codex-status --web</code>, or press <Kbd>w</Kbd> in the TUI. This page reconnects by itself.</p></div>
    ) : (
      <main className="shell" aria-busy="true" aria-label="Loading">
        <div className="sk" style={{ height: 44, width: 340, marginBottom: 18 }} />
        <div className="hero">{[4, 3, 3, 2].map((c, i) => <div key={i} className="sk" style={{ height: 150, gridColumn: `span ${c}` }} />)}</div>
        <div className="sk" style={{ height: 260 }} />
      </main>
    );
  }

  const drawerOpen = ui.selected && !!current;
  return (
    <>
      <Header snapshot={snapshot} connection={connection} now={now} theme={theme} onTheme={setTheme} onRefresh={refresh}
        onPalette={() => setPalette(true)} onHelp={() => dispatch({ type: "toggle", key: "helpOpen" })} />
      <main className="shell" data-drawer={drawerOpen ? "open" : "closed"}>
        {connection !== "live" && (
          <div className="banner" role="alert">
            {connection === "stopped"
              ? <>The web server stopped (the TUI quit, <Kbd>W</Kbd> was pressed, or no browser was open for a minute). Showing the last data; this page reconnects when it is back.</>
              : "Connection lost, reconnecting…"}
          </div>
        )}
        <Hero snapshot={snapshot} liveChats={live} series={series} showAccount={ui.showAccount} onAccount={() => dispatch({ type: "toggle", key: "showAccount" })} minimal={f.minimal} showArc={f.showArc}
          query={ui.query} onFilter={(query) => dispatch({ type: "setQuery", query })}
          onPick={(id) => dispatch({ type: "pick", id })} onArchived={(id) => { setArcOn(true); dispatch({ type: "pick", id }); }} onAgents={() => setMainView("agents")} />
        {mainView === "agents" ? (
          <AgentsView sessions={sessions} live={live} query={ui.query} view={mainView} onView={setMainView}
            onOpen={(id) => { setMainView("chats"); dispatch({ type: "pick", id }); }} onClearQuery={() => dispatch({ type: "setQuery", query: "" })} />
        ) : (
          <Chats snapshot={snapshot} live={live} archived={archived} f={f} cursor={ui.cursor} picked={ui.selected} expanded={ui.expanded} query={ui.query}
            onPick={(id) => dispatch({ type: "pick", id })} onToggle={(id) => dispatch({ type: "toggleExpanded", id })}
            onLevel={(level) => dispatch({ type: "setLevel", level })} onFlag={(flag) => (flag === "showArc" ? toggleArc() : dispatch({ type: "toggleFlag", flag, current: f[flag] }))}
            onQuery={(query) => dispatch({ type: "setQuery", query })} searchRef={search} view={mainView} onView={setMainView} subs={subs} />
        )}
        <p className="foot">ctx = last turn's input (cached included) vs the model context window Codex reports (alerts: 200k window at {snapshot.view.ctx_rules["200k"].join(" / ")}%, 1M at {snapshot.view.ctx_rules["1m"].join(" / ")}%, ticks on each bar are that chat's own levels) · * = waiting on a permission prompt · the same data as the terminal view, served from this machine only</p>
      </main>

      <Drawer x={current} open={drawerOpen} onClose={() => dispatch({ type: "back" })} series={series} />

      <nav className="dock glass glass-strong" aria-label="Keyboard hints">
        <span className="mode" data-m={ui.selected ? "selected" : "navigate"}>{ui.selected ? "SELECTED" : "NAVIGATE"}</span>
        <span><Kbd>↑</Kbd><Kbd>↓</Kbd>move</span>
        <span><Kbd>⏎</Kbd>{ui.selected ? "copy resume" : "details"}</span>
        {ui.selected && <span><Kbd>esc</Kbd>back</span>}
        <span className="opt"><Kbd>+</Kbd><Kbd>−</Kbd>detail</span>
        <span className="opt"><Kbd>/</Kbd>filter</span>
        <span><Kbd>?</Kbd>keys</span>
      </nav>

      <Palette open={palette} commands={commands} onClose={() => setPalette(false)} />
      <Help open={ui.helpOpen} onClose={() => dispatch({ type: "closeHelp" })} />
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
      <Page />
    </ToastProvider>
  );
}
