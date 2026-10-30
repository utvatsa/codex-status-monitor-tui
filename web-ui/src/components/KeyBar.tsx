// The bottom bar, like the TUI's footer: the mode (NAVIGATE / SELECTED) and the keys that matter right now.
import type { Session } from "../types";
import { VIEWS, viewIndex } from "../lib/view";
import { copyText } from "../lib/clipboard";
import { useToast } from "./ui/Toast";
import { Button, Kbd, cx } from "./ui/primitives";
import s from "./KeyBar.module.css";

const HINTS: [string, string][] = [["↑ ↓", "move"], ["⏎", "select"], ["+ −", "detail"], ["a", "archived"], ["/", "filter"], ["?", "all keys"]];

export function KeyBar({ selected, current, n, level, onBack }: { selected: boolean; current: Session | undefined; n: number; level: number; onBack: () => void }) {
  const toast = useToast();
  const copy = async (text: string, what: string) => toast((await copyText(text)) ? `Copied the ${what}` : "Copy failed");
  return (
    <footer className={s.bar}>
      <span className={cx(s.mode, selected ? s.sel : s.nav)}>{selected ? "SELECTED" : "NAVIGATE"}</span>
      <div className={s.info}>
        {selected && current ? (
          <>
            <b className={s.name}>#{n} {current.label}</b>
            <Button size="small" variant="primary" onClick={() => copy(current.resume, "resume command")}>Copy resume <Kbd>⏎</Kbd></Button>
            <Button size="small" className={s.wideOnly} onClick={() => copy(current.sid, "session id")}>Copy id <Kbd>i</Kbd></Button>
            <Button size="small" className={s.wideOnly} onClick={() => copy(current.clean, "fresh-chat command")}>Copy fresh <Kbd>f</Kbd></Button>
            <Button size="small" variant="ghost" icon="back" onClick={onBack}>Back <Kbd>Esc</Kbd></Button>
          </>
        ) : (
          HINTS.map(([k, d]) => <span key={k} className={s.hint}><Kbd>{k}</Kbd>{d}</span>)
        )}
      </div>
      <span className={s.view}>{VIEWS[viewIndex(level)]} view · level {level}</span>
    </footer>
  );
}
