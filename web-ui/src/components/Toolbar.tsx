import { forwardRef } from "react";
import { VIEWS, viewIndex, type FlagName, type Flags } from "../lib/view";
import { Icon } from "./ui/Icon";
import { Kbd, cx } from "./ui/primitives";
import s from "./Toolbar.module.css";

interface Props {
  level: number;
  flags: Flags & { arcPrompt: boolean };
  query: string;
  onLevel: (viewIdx: number) => void;
  onFlag: (f: FlagName) => void;
  onArcPrompt: () => void;
  onQuery: (q: string) => void;
}

// [flag, label, key, shown as "on" when the flag is false]
const TOGGLES: [FlagName, string, string, boolean][] = [
  ["showArc", "Archived", "a", false],
  ["compact", "Compact rows", "c", false],
  ["noPrompts", "Prompts", "p", true],
  ["verbose", "Subagents", "v", false],
];

export const Toolbar = forwardRef<HTMLInputElement, Props>(function Toolbar({ level, flags, query, onLevel, onFlag, onArcPrompt, onQuery }, searchRef) {
  const vi = viewIndex(level);
  return (
    <div className={s.toolbar} role="toolbar" aria-label="View options">
      <div className={s.seg} role="radiogroup" aria-label="Detail level">
        {VIEWS.map((v, i) => (
          <button key={v} type="button" role="radio" aria-checked={vi === i} className={cx(vi === i && s.on)} onClick={() => onLevel(i)}
            title={`${v} view (${i + 1})`}>{v}</button>
        ))}
      </div>
      <div className={s.chips}>
        {TOGGLES.map(([flag, label, key, inverted]) => {
          const on = inverted ? !flags[flag] : flags[flag];
          return (
            <button key={flag} type="button" className={cx(s.chip, on && s.on)} aria-pressed={on} onClick={() => onFlag(flag)} title={`${label} on/off (${key})`}>
              <span className={s.tick} aria-hidden="true">{on ? <Icon name="check" size={12} /> : null}</span>{label}
            </button>
          );
        })}
        {flags.showArc && (
          <button type="button" className={cx(s.chip, flags.arcPrompt && s.on)} aria-pressed={flags.arcPrompt} onClick={onArcPrompt} title="Archived prompt line on/off (t)">
            <span className={s.tick} aria-hidden="true">{flags.arcPrompt ? <Icon name="check" size={12} /> : null}</span>Archived prompts
          </button>
        )}
      </div>
      <label className={s.search}>
        <Icon name="search" size={15} />
        <span className="sr-only">Filter chats</span>
        <input ref={searchRef} type="search" placeholder="Filter by title, folder, id or model" value={query} onChange={(e) => onQuery(e.target.value)} />
        {!query && <Kbd>/</Kbd>}
      </label>
    </div>
  );
});
