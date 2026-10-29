// The floating glass header: brand, connection state and address, then the palette button, refresh, theme popover and help.
import { useEffect, useRef, useState } from "react";
import { since } from "../lib/format";
import { THEMES, type ThemeId } from "../hooks/useTheme";
import { modeOf } from "./derive";
import type { Connection, Snapshot } from "../types";
import { I, Kbd } from "./parts";

const STATUS: Record<Connection, string> = { live: "Live", connecting: "Connecting", retrying: "Reconnecting", stopped: "Server stopped" };
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

interface Props {
  snapshot: Snapshot | null; connection: Connection; now: number; theme: ThemeId;
  onTheme: (t: ThemeId) => void; onRefresh: () => void; onPalette: () => void; onHelp: () => void;
}

export function Header({ snapshot, connection, now, theme, onTheme, onRefresh, onPalette, onHelp }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const fed = snapshot ? (snapshot.source === "tui" ? "fed by the TUI" : "headless --web") : "";
  return (
    <header className="hdr glass glass-strong">
      <a className="hdr-brand" href={location.pathname} aria-label="Codex Status, reload">
        <span className="hdr-logo"><I name="gauge" size={16} /></span><span>Codex Status</span>
      </a>
      <div className="hdr-live" aria-live="polite">
        <span className="pulse" data-s={connection} />
        <span className="lbl">{STATUS[connection]}</span>
        <code className="hdr-host" title="Served from this machine only">{location.host}</code>
        <span className="chip hdr-ro" title="This page only reads Codex's data. The one thing it can change is the context window and alert levels of a single chat, saved in this tool's own settings file.">read-only data</span>
        {snapshot && connection === "live" && <span className="hdr-meta">{fed} · updated <span className="tnum">{since(now - snapshot.generated)}</span> ago</span>}
      </div>
      <span className="hdr-spacer" />
      <button className="btn hdr-search" onClick={onPalette} aria-label="Open the command palette" title="Command palette">
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><I name="search" size={15} /><span className="txt">Search or run…</span></span>
        <span className="keys"><Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd><Kbd>K</Kbd></span>
      </button>
      <button className="btn" data-icon="" onClick={onRefresh} aria-label="Read again now" title="Read again now (r)"><I name="refresh" /></button>
      <div ref={box} style={{ display: "contents" }}>
        <button className="btn theme-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Switch theme" title="Switch theme (d cycles, m flips light and dark)">
          <I name="theme" /><span className="theme-l">Theme</span>
        </button>
        {open && (
          <div className="theme-pop glass glass-strong" role="menu" aria-label="Switch theme">
            <div className="pop-h">Switch theme</div>
            {THEMES.map((t) => (
              <button key={t.id} role="menuitemradio" aria-checked={theme === t.id} className="theme-opt" data-on={theme === t.id || undefined}
                onClick={() => { onTheme(t.id); setOpen(false); }}>
                <span className="sw" style={{ background: t.swatch[0] }}><i style={{ background: t.swatch[1] }} /></span>
                <span>{t.label}<small>{modeOf(t.id)} · {t.hint}</small></span>
                {theme === t.id && <span style={{ marginLeft: "auto", color: "var(--accent)" }}><I name="check" /></span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="btn" data-icon="" onClick={onHelp} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)"><I name="keyboard" /></button>
    </header>
  );
}
