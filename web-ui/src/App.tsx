// The page. Data comes from useSnapshot (the server's live stream); everything the user changes lives in one
// reducer (state/ui.ts). This component only derives what to show from the two and wires keys and clicks to actions.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { attentionItems } from "./lib/attention";
import { AccountLine, AttentionCard, KpiTiles, UsageCard } from "./components/Overview";
import { MachineBand } from "./components/MachineBand";
import { AgentsView, ViewSwitch } from "./components/AgentsView";
import { KeyBar } from "./components/KeyBar";
import { DetailPanel, SessionCard, SessionRow, SubOpenProvider, type ItemProps } from "./components/Session";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { Toolbar } from "./components/Toolbar";
import { TopBar } from "./components/TopBar";
import { Card } from "./components/ui/Card";
import { Icon } from "./components/ui/Icon";
import { Badge, Kbd } from "./components/ui/primitives";
import { useToast } from "./components/ui/Toast";
import { useHotkeys, type Keymap } from "./hooks/useHotkeys";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useNow } from "./hooks/useNow";
import { requestRefresh, useSnapshot } from "./hooks/useSnapshot";
import { nextTheme, THEMES, useTheme } from "./hooks/useTheme";
import type { MainView } from "./lib/agents";
import { copyText } from "./lib/clipboard";
import { plural } from "./lib/format";
import { storage } from "./lib/storage";
import { LEVEL_REPS } from "./lib/view";
import { effectiveFlags, initialUi, uiReducer, type UiState } from "./state/ui";
import type { Session } from "./types";
import s from "./App.module.css";

/** Saved preferences, then ?level= and ?theme= from the address (handy for bookmarks). */
function startState(): { ui: UiState; theme: string | null } {
  const q = new URLSearchParams(location.search);
  const saved = Number(storage.get("level"));
  const fromUrl = q.has("level") ? Number(q.get("level")) : NaN;
  const level = !Number.isNaN(fromUrl) ? fromUrl : storage.get("level") !== null && !Number.isNaN(saved) ? saved : null;
  return { ui: { ...initialUi, level, arcPrompt: storage.get("arcPrompt") !== "false" }, theme: q.get("theme") };
}

const matches = (x: Session, q: string) =>
  !q || [x.label, x.title, x.folder, x.sid, x.model, x.running_in].some((v) => (v || "").toLowerCase().includes(q));

export default function App() {
  const start = useMemo(startState, []);
  const { snapshot, connection } = useSnapshot();
  const [ui, dispatch] = useReducer(uiReducer, start.ui);
  const [theme, setTheme] = useTheme(start.theme);
  const now = useNow(1000);
  const wide = useMediaQuery("(min-width: 1100px)");
  const toast = useToast();
  const search = useRef<HTMLInputElement>(null);
  const askedArc = useRef(false);
  const [mainView, setMainView] = useState<MainView>("chats");     // not saved: the page always opens on the chat list

  const f = { ...effectiveFlags(ui, snapshot?.view.level ?? 75), arcPrompt: ui.arcPrompt, allSubagents: ui.allSubagents };

  // What to list: live chats, then archived ones, both filtered. Numbering follows this order, like the TUI.
  const q = ui.query.trim().toLowerCase();
  const sessions = snapshot?.sessions ?? [];
  const live = snapshot?.view.show_live ? sessions.filter((x) => x.active && matches(x, q)) : [];
  const archived = f.showArc ? sessions.filter((x) => !x.active && matches(x, q)) : [];
  const items = useMemo(() => [...live, ...archived], [live, archived]);
  const ids = items.map((x) => x.sid);
  const idKey = ids.join(",");
  const current = items.find((x) => x.sid === ui.cursor);

  // Re-sync only when the list of ids really changes (idKey is a string, so equal lists don't re-run this).
  useEffect(() => { dispatch({ type: "sync", ids: idKey ? idKey.split(",") : [] }); }, [idKey]);

  useEffect(() => {
    if (ui.level !== null) storage.set("level", String(ui.level));
    storage.set("arcPrompt", String(ui.arcPrompt));
  }, [ui.level, ui.arcPrompt]);

  // Archived chats are read by the data owner only when someone wants them: ask once, when they are first shown.
  useEffect(() => {
    if (snapshot && f.showArc && !snapshot.view.has_arc && !askedArc.current) {
      askedArc.current = true;
      requestRefresh(true);
    }
  }, [snapshot, f.showArc]);

  // "Show those chats" on the disk alert: archived chats may not be listed yet (they are read on demand), so the pick waits for them.
  const pendingPick = useRef<string[] | null>(null);
  const hasArc = snapshot?.view.has_arc;
  useEffect(() => {
    const want = pendingPick.current;
    if (!want) return;
    const hit = want.find((id) => ids.includes(id));
    if (hit) dispatch({ type: "pick", id: hit });
    if (hit || hasArc) pendingPick.current = null;
  }, [idKey, hasArc]);          // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the highlighted chat on screen.
  useEffect(() => {
    if (ui.cursor) document.querySelector(`[data-sid="${ui.cursor}"]`)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [ui.cursor, ui.selected]);

  const copy = useCallback(async (text: string, what: string) => {
    toast((await copyText(text)) ? `Copied the ${what}` : "Copy failed: select the text and press ⌘C");
  }, [toast]);

  const showChat = (sid: string) => {
    if (ui.query) dispatch({ type: "setQuery", query: "" });
    dispatch({ type: "pick", id: sid });
  };
  const showEnded = (sids: string[]) => {
    if (ui.query) dispatch({ type: "setQuery", query: "" });
    const here = sids.find((id) => ids.includes(id));
    if (f.showArc && here) return dispatch({ type: "pick", id: here });
    if (!f.showArc || ui.query || !snapshot?.view.has_arc) pendingPick.current = sids;     // the list is about to change: pick when it has
    if (!f.showArc) dispatch({ type: "toggleFlag", flag: "showArc", current: false });
  };

  const refresh = () => {
    requestRefresh(f.showArc);
    toast("Reading again…");
  };

  const keys: Keymap = ui.helpOpen ? { "?": () => dispatch({ type: "closeHelp" }) } : {
    ArrowDown: () => dispatch({ type: "move", delta: 1, ids }),
    ArrowUp: () => dispatch({ type: "move", delta: -1, ids }),
    j: () => dispatch({ type: "move", delta: 1, ids }),
    k: () => dispatch({ type: "move", delta: -1, ids }),
    g: () => (mainView === "agents" ? setMainView("chats") : dispatch({ type: "jump", to: "first", ids })),
    A: () => setMainView(mainView === "agents" ? "chats" : "agents"),
    G: () => dispatch({ type: "jump", to: "last", ids }),
    Enter: () => {
      if (!current) return;
      if (!ui.selected) dispatch({ type: "select" });
      else copy(current.resume, "resume command");
    },
    y: () => current && copy(current.resume, "resume command"),
    i: () => current && copy(current.sid, "session id"),
    f: () => current && copy(current.clean, "fresh-chat command"),
    Escape: () => (mainView === "agents" ? setMainView("chats") : dispatch({ type: "back" })),
    b: () => dispatch({ type: "back" }),
    "+": () => dispatch({ type: "stepLevel", delta: 1, current: f.level }),
    "=": () => dispatch({ type: "stepLevel", delta: 1, current: f.level }),
    "-": () => dispatch({ type: "stepLevel", delta: -1, current: f.level }),
    _: () => dispatch({ type: "stepLevel", delta: -1, current: f.level }),
    a: () => dispatch({ type: "toggleFlag", flag: "showArc", current: f.showArc }),
    c: () => dispatch({ type: "toggleFlag", flag: "compact", current: f.compact }),
    p: () => dispatch({ type: "toggleFlag", flag: "noPrompts", current: f.noPrompts }),
    v: () => dispatch({ type: "toggleFlag", flag: "verbose", current: f.verbose }),
    s: () => dispatch({ type: "toggle", key: "allSubagents" }),
    t: () => dispatch({ type: "toggle", key: "arcPrompt" }),
    u: () => dispatch({ type: "toggle", key: "showAccount" }),
    e: () => dispatch({ type: "expandAll", ids }),
    r: refresh,
    "/": () => search.current?.focus(),
    "?": () => dispatch({ type: "toggle", key: "helpOpen" }),
    d: () => {
      const t = nextTheme(theme);
      setTheme(t);
      toast(`Theme: ${THEMES.find((x) => x.id === t)?.label}`);
    },
    ...Object.fromEntries([1, 2, 3, 4, 5].map((k) => [String(k), () => dispatch({ type: "setLevel", level: LEVEL_REPS[k - 1] })])),
  };
  useHotkeys(keys, {
    onTypingEscape: (el) => {
      dispatch({ type: "setQuery", query: "" });
      el.blur();
    },
  });

  if (!snapshot) return <Waiting connection={connection} />;

  const [r200, r1m] = [snapshot.view.ctx_rules["200k"], snapshot.view.ctx_rules["1m"]];
  let n = 0;
  const itemProps = (x: Session): ItemProps => ({
    session: x,
    n: ++n,
    flags: f,
    highlighted: ui.cursor === x.sid && !ui.selected,
    selected: ui.cursor === x.sid && ui.selected,
    expanded: !!ui.expanded[x.sid],
    inlineDetails: !wide,
    onPick: (id) => dispatch({ type: "pick", id }),
    onToggle: (id) => dispatch({ type: "toggleExpanded", id }),
  });

  return (
    <SubOpenProvider>
      <TopBar snapshot={snapshot} connection={connection} now={now} theme={theme} onTheme={setTheme} onRefresh={refresh}
        onHelp={() => dispatch({ type: "toggle", key: "helpOpen" })} />
      {connection !== "live" && (
        <div className={s.banner} role="alert">
          {connection === "stopped"
            ? <>The web server stopped (the TUI quit, <Kbd>W</Kbd> was pressed, or no browser was open for a minute). Showing the last data; this page reconnects when it is back: <code>cust-codex-status --web</code> or <Kbd>w</Kbd> in the TUI.</>
            : "Connection lost, reconnecting…"}
        </div>
      )}

      <main className={s.main}>
        <AccountLine snapshot={snapshot} showAccount={ui.showAccount} onToggle={() => dispatch({ type: "toggle", key: "showAccount" })} />
        <KpiTiles snapshot={snapshot} showArc={f.showArc} onOpenAgents={() => setMainView("agents")} />

        {!f.minimal && <MachineBand system={snapshot.system ?? []} onPick={showChat} onShowEnded={showEnded} />}

        {!f.minimal && (
          <div className={attentionItems(snapshot).length ? s.twoUp : undefined}>
            <UsageCard snapshot={snapshot} />
            <AttentionCard snapshot={snapshot} />
          </div>
        )}

        <div className={s.toolbarWrap}>
          <Toolbar ref={search} level={f.level} flags={f} query={ui.query}
            onLevel={(i) => dispatch({ type: "setLevel", level: LEVEL_REPS[i] })}
            onFlag={(flag) => dispatch({ type: "toggleFlag", flag, current: f[flag] })}
            onArcPrompt={() => dispatch({ type: "toggle", key: "arcPrompt" })}
            onQuery={(query) => dispatch({ type: "setQuery", query })} />
        </div>

        {!f.minimal && (
          <p className={s.legend}>
            <Badge level="OK" /> nothing to do
            <Badge level="AMBER" /> context ≥{r200[0]}% (200k) / ≥{r1m[0]}% (1M), waiting on a prompt, memory, or idle &gt;1h
            <Badge level="RED" /> context ≥{r200[1]}% / ≥{r1m[1]}%
          </p>
        )}

        <div className={wide ? s.split : undefined}>
          <div className={s.lists}>
            {mainView === "agents" ? (
              <AgentsView sessions={sessions} query={ui.query} view={mainView} onView={setMainView}
                onOpenChat={(sid) => { setMainView("chats"); showChat(sid); }} />
            ) : <>
            <ViewSwitch view={mainView} onChange={setMainView} />
            {snapshot.view.show_live && (
              <Card id="live" title={<><Icon name="chat" size={14} />Live chats</>} flush
                aside={<>{plural(live.length, "chat")}{f.compact ? " · compact" : " · a process is running; idle ones still hold memory"}</>}>
                {live.length === 0 ? <Empty text={q ? "No live chat matches the filter." : "No chat is running."} />
                  : f.compact ? live.map((x) => <SessionRow key={x.sid} {...itemProps(x)} />)
                  : live.map((x) => <SessionCard key={x.sid} {...itemProps(x)} />)}
              </Card>
            )}
            {f.showArc && (
              <Card id="archived" title={<><Icon name="archive" size={14} />Archived / ended</>} tone="muted" flush
                aside={snapshot.view.has_arc ? `last ${snapshot.view.days}d · newest ${archived.length}` : "loading…"}>
                {!snapshot.view.has_arc ? <Empty text="Reading archived chats…" loading />
                  : archived.length === 0 ? <Empty text={q ? "No archived chat matches the filter." : `None in the last ${snapshot.view.days} days.`} />
                  : archived.map((x) => <SessionRow key={x.sid} {...itemProps(x)} />)}
                {snapshot.view.hidden > 0 && (
                  <p className={s.hidden}>{plural(snapshot.view.hidden, "older archived chat")} not shown: start with <code>-n 0</code> for all, <code>-n N</code> for more, <code>-d DAYS</code> to widen.</p>
                )}
              </Card>
            )}
            </>}
          </div>
          {wide && <DetailPanel x={current} selected={ui.selected} onBack={() => dispatch({ type: "back" })} />}
        </div>

        <p className={s.footnote}>
          ctx = last turn's input (cached included) vs the model context window Codex reports · * = waiting on a permission prompt ·
          the same data as the terminal view, served from this machine only
        </p>
      </main>

      <KeyBar selected={ui.selected} current={current} n={current ? ids.indexOf(current.sid) + 1 : 0} level={f.level} onBack={() => dispatch({ type: "back" })} />
      <ShortcutsDialog open={ui.helpOpen} onClose={() => dispatch({ type: "closeHelp" })} />
    </SubOpenProvider>
  );
}

function Empty({ text, loading }: { text: string; loading?: boolean }) {
  return <p className={loading ? `${s.empty} ${s.loading}` : s.empty}>{text}</p>;
}

/** Before the first snapshot: a skeleton while connecting, a clear message when the server is gone. */
function Waiting({ connection }: { connection: string }) {
  if (connection === "stopped") {
    return (
      <div className={s.down}>
        <Icon name="plug" size={28} />
        <h1>Can't reach the web server</h1>
        <p>Start it again with <code>cust-codex-status --web</code>, or press <Kbd>w</Kbd> in the TUI. This page reconnects by itself.</p>
      </div>
    );
  }
  return (
    <div className={s.skeleton} aria-busy="true" aria-label="Loading">
      <div className={s.skBar} />
      <div className={s.skTiles}>{[0, 1, 2, 3].map((i) => <div key={i} />)}</div>
      <div className={s.skBlock} />
      <div className={s.skBlock} />
    </div>
  );
}
