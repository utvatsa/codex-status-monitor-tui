// One chat, three ways: a card (lean / standard / full views), a dense row (compact views and archived chats),
// and the full details (the side panel on wide screens, or under the selected row on narrow ones).
import { createContext, useContext, useId, useMemo, useState, type ReactNode } from "react";
import type { Session } from "../types";
import { PHASES, PHASE_HINT, PHASE_LABEL, agentRows, listStartsOpen, sessionCode, subCounts } from "../lib/agents";
import { copyText } from "../lib/clipboard";
import { useToast } from "./ui/Toast";
import type { Flags } from "../lib/view";
import { Icon } from "./ui/Icon";
import { WindowControl } from "./WindowControl";
import { Badge, Button, CopyButton, Meter, cx } from "./ui/primitives";
import s from "./Session.module.css";

export interface ItemProps {
  session: Session;
  n: number;
  flags: Flags & { arcPrompt: boolean; allSubagents: boolean };
  highlighted: boolean;                 // keyboard cursor (NAVIGATE)
  selected: boolean;                    // picked (SELECTED)
  expanded: boolean;                    // chevron open (rows)
  inlineDetails: boolean;               // narrow screen: details go under the row instead of the side panel
  onPick: (id: string) => void;
  onToggle: (id: string) => void;
}

function State({ x }: { x: Session }) {
  const kind = x.state.replace("?", "");
  return (
    <span className={cx(s.state, s[`st_${kind}`])} title={x.waiting ? `waiting on a permission prompt (${x.waiting})` : undefined}>
      <i />{x.state}{x.waiting ? "*" : ""}
    </span>
  );
}

function Context({ x, compact }: { x: Session; compact?: boolean }) {
  return (
    <span className={cx(s.ctx, compact && s.ctxCompact)} title={`last turn's input (cached included): ${x.ctx} of a ${x.window} window; this chat's alerts start at ${x.ctx_amber} (amber) and ${x.ctx_red} (red)`}>
      <Meter pct={x.ctx_pct} label="context window" levels={[x.ctx_amber_pct, x.ctx_red_pct]} />
      <b className="tnum">{x.ctx_pct}%{x.maybe_1m && <abbr title="85%+ of an assumed 200k window: it may really be a 1M window">~</abbr>}</b>
      {!compact && <span className={cx(s.dim, "tnum")}>{x.ctx}/{x.window}</span>}
    </span>
  );
}

/** A stat-line value that copies `text` when clicked (and never selects the card it sits on). */
function CopyStat({ k, label, text, what }: { k: string; label: string; text: string; what: string }) {
  const toast = useToast();
  return (
    <div>
      <dt>{k}</dt>
      <dd className="tnum">
        <button type="button" className={s.copyStat} title={`Copy the ${what}`}
          onClick={async (e) => { e.stopPropagation(); toast((await copyText(text)) ? `Copied the ${what}` : "Copy failed: select the text and press ⌘C"); }}>{label}</button>
      </dd>
    </div>
  );
}

function Stats({ x, copy }: { x: Session; copy?: boolean }) {
  const running = x.subagents.filter((a) => a.running).length;
  const items: [string, ReactNode][] = [["turns", x.turns], ["in", x.inp], ["cached", x.cache_r], ["out", x.out], ["reasoning", x.reasoning]];
  if (x.subagents.length) items.push(["subagents", `${running}/${x.subagents.length}`]);
  if (x.active && x.mem_mb) items.push(["mem", `${x.mem_mb}MB`]);
  return (
    <dl className={s.stats}>
      {items.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd className="tnum">{v}</dd></div>))}
      {copy && <CopyStat k="id" label={`#${sessionCode(x.sid)}`} text={x.sid} what="session id" />}
      {copy && x.pid !== null && <CopyStat k="pid" label={String(x.pid)} text={String(x.pid)} what="pid" />}
    </dl>
  );
}

const mb = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString();

/** What the chat leaves on disk: the total, and the parts of 1 MB or more (biggest first, as the server sends them). */
function Footprint({ x, totalOnly }: { x: Session; totalOnly?: boolean }) {
  if (!x.files) return null;
  const parts = totalOnly ? [] : x.files.parts.filter(([, size]) => size >= 1);
  return (
    <span className={s.footprint} title="what this chat leaves on disk (transcript, tool results, file history, temp files)">
      {!totalOnly && "Disk "}<b className="tnum">{mb(x.files.total_mb)} MB</b>
      {parts.map(([name, size]) => <span key={name}> · {name} {mb(size)}</span>)}
    </span>
  );
}

/** The server's suggestions for tidying a chat. Commands are shown and copied, never run from the page. */
function Housekeeping({ x, showCommand }: { x: Session; showCommand?: boolean }) {
  if (!x.advice.length) return null;
  return (
    <div className={s.field}>
      <span className={s.k}>tidy up</span>
      <div className={s.advice} aria-label="Housekeeping">
        <b className={s.adviceHead}>Housekeeping</b>
        {x.advice.map((a) => (
          <div key={a.kind} className={s.adviceItem}>
            <span>{a.text}</span>
            {a.command && showCommand && <code>{a.command}</code>}
            {a.command && <CopyButton text={a.command} what="housekeeping command" label="Copy command" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function Reason({ x, quiet }: { x: Session; quiet?: boolean }) {
  if (!x.why.length) return quiet ? null : <p className={cx(s.reason, s.reasonOk)}>Nothing needs attention</p>;
  return <p className={cx(s.reason, s[`reason_${x.health.toLowerCase()}`])}>{x.why.join(" · ")}</p>;
}

function Field({ k, children, mono }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className={s.field}>
      <span className={s.k}>{k}</span>
      <span className={cx(s.v, mono && s.mono)}>{children}</span>
    </div>
  );
}

function Command({ k, text, what, note }: { k: string; text: string; what: string; note?: string }) {
  return (
    <div className={s.command}>
      <span className={s.k}>{k}</span>
      <div className={s.cmdBox}>
        <code>{text}</code>
        <CopyButton text={text} what={what} />
      </div>
      {note && <span className={s.note}>{note}</span>}
    </div>
  );
}

function Prompts({ x, oneLine }: { x: Session; oneLine?: boolean }) {
  const c = cx(s.prompt, oneLine && s.prompt1);
  return (
    <>
      <Field k="first"><span className={c}>{x.first_prompt || "–"}</span></Field>
      <Field k="latest"><span className={c}>{x.latest_prompt || "–"}</span></Field>
    </>
  );
}

/** Each chat's open/closed choice for its subagent list, kept by the app (not by the card) so it survives the chat list being replaced by the
 *  Agents view and brought back. Without a provider a card keeps its own choice. */
const SubOpenCtx = createContext<{ get: (sid: string) => boolean | undefined; set: (sid: string, open: boolean) => void } | null>(null);

export function SubOpenProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, boolean>>({});
  const value = useMemo(() => ({ get: (sid: string) => map[sid], set: (sid: string, open: boolean) => setMap((m) => ({ ...m, [sid]: open })) }), [map]);
  return <SubOpenCtx.Provider value={value}>{children}</SubOpenCtx.Provider>;
}

const PHASE_GLYPH = { active: "●", idle: "●", done: "✓", closed: "⊘" } as const;

/** The subagent list behind a header button (`▸ subagents (N)` + a count per state). Open/closed is this chat's own choice, kept here in
 *  state (the component stays mounted across refreshes, keyed by the chat's sid), so a refresh or a re-sort never resets it. */
function Subagents({ x, forceOpen }: { x: Session; forceOpen?: boolean }) {
  const toast = useToast();
  const listId = useId();
  const rows = agentRows(x);
  const [startOpen] = useState(() => listStartsOpen(rows));
  const shared = useContext(SubOpenCtx);
  const [mine, setMine] = useState<boolean | null>(null);
  const picked = shared ? shared.get(x.sid) ?? null : mine;        // null until the user toggles; then their choice wins
  const setPicked = (open: boolean) => (shared ? shared.set(x.sid, open) : setMine(open));
  if (!rows.subs.length) return null;
  const open = picked ?? (forceOpen || startOpen);
  const counts = subCounts(rows);
  return (
    <div className={s.subs}>
      <button type="button" className={s.subsHead} aria-expanded={open} aria-controls={listId}
        onClick={(e) => { e.stopPropagation(); setPicked(!open); }}>
        <span className={s.k}>{open ? "▾" : "▸"} subagents ({rows.subs.length})</span>
        <span className={s.subCounts}>
          {PHASES.filter((p) => counts[p] > 0).map((p) => (
            <span key={p} className={s.subCount} data-state={p} title={PHASE_HINT[p]}>{PHASE_GLYPH[p]} {counts[p]} {PHASE_LABEL[p]}</span>
          ))}
        </span>
      </button>
      {open && (
        <ul id={listId} className={s.subList}>
          {rows.subs.map((a, i) => (
            <li key={a.full || i} data-state={a.state}>
              <i className={s.subDot} data-state={a.state} />
              <code>{a.type}</code>
              {a.full ? (
                <button type="button" className={cx(s.copyStat, s.dim, s.subCode)} title={`Copy the agent id ${a.full}`}
                  onClick={async (e) => { e.stopPropagation(); toast((await copyText(a.full)) ? "Copied the agent id" : "Copy failed: select the text and press ⌘C"); }}><code>#{a.code}</code></button>
              ) : <span />}
              <span className={s.subTag} data-state={a.state} title={PHASE_HINT[a.state]}>{a.state === "done" ? "✓ " : a.state === "closed" ? "⊘ " : ""}{PHASE_LABEL[a.state]}</span>
              <span className={s.subDesc}>{a.desc}</span>
              <span className={s.dim}>{a.model} · {a.ctx} · {a.turns}t · {a.out} out · {a.ago}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Everything about one chat (the TUI's expanded detail lines, plus prompts and subagents). */
export function SessionDetails({ x }: { x: Session; allSubagents?: boolean }) {
  return (
    <div className={s.details}>
      <Reason x={x} />
      <Stats x={x} />
      <WindowControl x={x} />
      {x.files && <Field k="disk"><Footprint x={x} /></Field>}
      <Housekeeping x={x} showCommand />
      <Field k="folder" mono>{x.folder}</Field>
      <Field k="id" mono>
        {x.sid}{x.pid ? <span className={s.dim}> · pid {x.pid}</span> : null}
        <CopyButton text={x.sid} what="session id" label="Copy id" />
      </Field>
      <Prompts x={x} />
      <Command k="resume" text={x.resume} what="resume command"
        note={x.active ? `Live in ${x.running_in}: close it there first, or add --fork-session.` : undefined} />
      <Command k="clean" text={x.clean} what="fresh-chat command" />
      {x.tips.length > 0 && <ul className={s.tips}>{x.tips.map((t) => <li key={t}>{t}</li>)}</ul>}
      <Subagents x={x} forceOpen />
    </div>
  );
}

export function SessionCard({ session: x, n, flags: f, highlighted, selected, inlineDetails, onPick }: ItemProps) {
  const title = (x.name && x.active ? `${x.name} · ` : "") + x.title;
  return (
    <article data-sid={x.sid} data-health={x.health} className={cx(s.card, highlighted && s.nav, selected && s.sel)} onClick={() => onPick(x.sid)}
      aria-current={selected || undefined}>
      <header className={s.cardHead}>
        <span className={cx(s.num, "tnum")}>{n}</span>
        <Badge level={x.health} large={!f.lean} />
        <h3 title={title}>{title}</h3>
        <span className={s.where}><Icon name={x.running_in.startsWith("terminal") ? "terminal" : "plug"} size={13} />{x.running_in}</span>
      </header>
      <div className={s.cardBody}>
        <div className={s.line}>
          <State x={x} />
          <span className={s.model}>{x.model}</span>
          <Context x={x} />
          <span className={s.dim}>last {x.last}{x.up ? ` · up ${x.up}` : ""}</span>
        </div>
        {selected && inlineDetails ? <SessionDetails x={x} allSubagents={f.allSubagents} /> : (
          <>
            <Reason x={x} quiet={f.lean} />
            <Stats x={x} copy={!f.lean} />
            {!f.lean && x.files && <Footprint x={x} />}
            {!f.lean && <Housekeeping x={x} />}
            {!f.lean && <Field k="folder" mono>{x.folder}</Field>}
            {!f.noPrompts && !f.lean && <Prompts x={x} oneLine />}
            <Command k="resume" text={x.resume} what="resume command" />
            {!f.lean && x.tips.length > 0 && <ul className={s.tips}>{x.tips.map((t) => <li key={t}>{t}</li>)}</ul>}
            {!f.lean && <Subagents x={x} forceOpen={f.allSubagents} />}
          </>
        )}
      </div>
    </article>
  );
}

export function SessionRow({ session: x, n, flags: f, highlighted, selected, expanded, inlineDetails, onPick, onToggle }: ItemProps) {
  const open = expanded || (selected && inlineDetails);
  return (
    <div data-sid={x.sid} data-health={x.active ? x.health : "ended"} className={cx(s.row, !x.active && s.arc, highlighted && s.nav, selected && s.sel)} onClick={() => onPick(x.sid)}
      aria-current={selected || undefined}>
      <div className={s.rowMain}>
        <span className={cx(s.num, "tnum")}>{n}</span>
        <Badge level={x.health} />
        {x.active ? <State x={x} /> : <span className={s.source}>{x.source}</span>}
        <span className={s.rowTitle} title={x.active ? x.label : x.title}>{x.active ? x.label : x.title}</span>
        <span className={s.where}>{x.running_in}</span>
        <span className={s.model}>{x.model}</span>
        <Context x={x} compact />
        <span className={cx(s.disk, "tnum")}>{x.files && <Footprint x={x} totalOnly />}</span>
        <span className={cx(s.cost, "tnum")}>{x.active ? "" : x.tokens}</span>
        <span className={cx(s.ago, "tnum")}>{x.last}</span>
        <Button variant="ghost" size="small" icon="chevron" className={cx(s.chev, open && s.chevOpen)} aria-expanded={open}
          aria-label={open ? "Collapse" : "Expand"} title={open ? "Collapse" : "Expand"}
          onClick={(e) => { e.stopPropagation(); onToggle(x.sid); }} />
      </div>
      {open ? <div className={s.rowDetails} onClick={(e) => e.stopPropagation()}><SessionDetails x={x} allSubagents={f.allSubagents} /></div> : (
        !x.active && f.arcPrompt && <p className={s.rowSub}><span className={s.k}>latest</span> {x.latest_prompt || "–"}</p>
      )}
      {!x.active && x.why.length > 0 && !open && <p className={cx(s.rowSub, s[`reason_${x.health.toLowerCase()}`])}>{x.why.join(" · ")}</p>}
    </div>
  );
}

/** The right-hand panel on wide screens: details of the selected chat (or the highlighted one while navigating). */
export function DetailPanel({ x, selected, onBack }: { x: Session | undefined; selected: boolean; onBack: () => void }) {
  if (!x) {
    return (
      <aside className={cx(s.panel, s.panelEmpty)} aria-label="Chat details">
        <Icon name="info" size={20} />
        <p>Select a chat to see its folder, ids, prompts and commands.</p>
        <p className={s.dim}>↑ ↓ to move, ⏎ to select</p>
      </aside>
    );
  }
  return (
    <aside className={cx(s.panel, selected && s.panelSel)} aria-label={`Details of ${x.label}`}>
      <header className={s.panelHead}>
        <Badge level={x.health} large />
        <div className={s.panelTitle}>
          <h3 title={x.title}>{x.label}</h3>
          <span className={s.dim}>{x.running_in} · {x.model} · last {x.last}</span>
        </div>
        {selected && <Button size="small" icon="back" onClick={onBack} title="Back to the list (Esc)">Back</Button>}
      </header>
      <div className={s.panelLine}><State x={x} /><Context x={x} /></div>
      <SessionDetails x={x} />
    </aside>
  );
}
