import { since } from "../lib/format";
import type { ThemeId } from "../hooks/useTheme";
import type { Connection, Snapshot } from "../types";
import { ThemeMenu } from "./ThemeMenu";
import { Button, cx } from "./ui/primitives";
import s from "./TopBar.module.css";

interface Props {
  snapshot: Snapshot | null;
  connection: Connection;
  now: number;
  theme: ThemeId;
  onTheme: (t: ThemeId) => void;
  onRefresh: () => void;
  onHelp: () => void;
}

const STATUS: Record<Connection, string> = { live: "Live", connecting: "Connecting", retrying: "Reconnecting", stopped: "Server stopped" };

export function TopBar({ snapshot, connection, now, theme, onTheme, onRefresh, onHelp }: Props) {
  const fed = snapshot ? (snapshot.source === "tui" ? "fed by the TUI" : "headless --web") : "";
  return (
    <header className={s.bar}>
      <div className={s.inner}>
        <a className={s.brand} href="/" aria-label="Codex Status, reload">
          <img src="/static/favicon.svg" alt="" width={24} height={24} />
          <span>Codex Status</span>
        </a>
        <span className={s.readonly} title="This page only reads Codex's data. The one thing it can change is the context window and alert levels of a single chat, saved in this tool's own settings file.">read-only data</span>

        <div className={s.status} aria-live="polite">
          <span className={cx(s.dot, s[connection])} />
          <span className={s.statusText}>{STATUS[connection]}</span>
          <code className={s.host} title="Served from this machine only">{location.host}</code>
          {snapshot && connection === "live" && (
            <span className={s.meta}>{fed} · updated <span className="tnum">{since(now - snapshot.generated)}</span> ago</span>
          )}
        </div>

        <div className={s.actions}>
          <Button variant="ghost" icon="refresh" onClick={onRefresh} title="Read again now (r)"><span className={s.hideNarrow}>Refresh</span></Button>
          <ThemeMenu theme={theme} onChange={onTheme} />
          <Button variant="ghost" icon="keyboard" onClick={onHelp} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" />
        </div>
      </div>
    </header>
  );
}
