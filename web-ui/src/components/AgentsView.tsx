// The Agents view: one card per live chat (its main agent) with a grid of subagent cards under it, filterable by state. It replaces the
// chat list while shown; the details side panel and the toolbar stay. Same data and helper as the chat cards (lib/agents.ts).
import { useState } from "react";
import { PHASES, PHASE_HINT, PHASE_LABEL, agentCards, filterCards, phaseTotals, sessionCode, type AgentFilter, type AgentState, type MainView } from "../lib/agents";
import { copyText } from "../lib/clipboard";
import type { Session, SubPhase } from "../types";
import { Card } from "./ui/Card";
import { Icon } from "./ui/Icon";
import { Button, Meter, cx } from "./ui/primitives";
import { useToast } from "./ui/Toast";
import s from "./AgentsView.module.css";

const GLYPH: Record<SubPhase, string> = { active: "●", idle: "●", done: "✓", closed: "⊘" };

/** `Chats | Agents`: switches the main section. */
export function ViewSwitch({ view, onChange }: { view: MainView; onChange: (v: MainView) => void }) {
  return (
    <div className={s.switchRow}>
      <div className={s.seg} role="radiogroup" aria-label="Main view">
        {(["chats", "agents"] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={view === v} className={cx(view === v && s.on)} onClick={() => onChange(v)}
            title={v === "chats" ? "The chat list" : "Agents and subagents (A)"}>{v === "chats" ? "Chats" : "Agents"}</button>
        ))}
      </div>
    </div>
  );
}

/** A small text button that copies `text` and never selects anything behind it. */
function Chip({ label, text, what, title }: { label: string; text: string; what: string; title: string }) {
  const toast = useToast();
  return (
    <button type="button" className={s.chip} title={title}
      onClick={async (e) => { e.stopPropagation(); toast((await copyText(text)) ? `Copied the ${what}` : "Copy failed: select the text and press ⌘C"); }}>{label}</button>
  );
}

const MAIN_HINT: Record<AgentState, string> = { active: "working now", waiting: "waiting on a permission prompt", idle: "alive but quiet", ended: "ended" };

function MainCard({ x, state, name, subs, onOpen }: { x: Session; state: AgentState; name: string; subs: number; onOpen: () => void }) {
  return (
    <div className={s.main} data-state={state} data-sid={x.sid} data-role="main">
      <div className={s.mainLine}>
        <i className={s.dot} aria-hidden />
        <h3 title={name}>{name}</h3>
        <Chip label={`#${sessionCode(x.sid)}`} text={x.sid} what="session id" title={`Copy the session id ${x.sid}`} />
        {x.pid !== null && <Chip label={`pid ${x.pid}`} text={String(x.pid)} what="pid" title="Copy the process id (shared by this chat's subagents)" />}
        <span className={s.word} title={MAIN_HINT[state]}>{state}</span>
        <Button size="small" icon="chat" className={s.open} onClick={onOpen} title="Show this chat in the list and its details">Open chat</Button>
      </div>
      <div className={s.mainStats}>
        <span className={s.mono}>{x.model}</span>
        <span className={s.ctx} title={`last turn's input (cached included): ${x.ctx} of a ${x.window} window`}>
          <Meter pct={x.ctx_pct} label="context window" levels={[x.ctx_amber_pct, x.ctx_red_pct]} />
          <b className="tnum">{x.ctx_pct}%</b>
        </span>
        {x.mem_mb ? <span className="tnum">{x.mem_mb}MB</span> : null}
        <span>last {x.last}</span>
        <span>{subs === 0 ? "no subagents" : `${subs} subagent${subs === 1 ? "" : "s"}`}</span>
      </div>
    </div>
  );
}

export function AgentsView({ sessions, query, view, onView, onOpenChat }: {
  sessions: Session[]; query: string; view: MainView; onView: (v: MainView) => void; onOpenChat: (sid: string) => void;
}) {
  const [filter, setFilter] = useState<AgentFilter>("all");
  const all = agentCards(sessions);
  const totals = phaseTotals(all);
  const cards = filterCards(all, filter, query);
  const subTotal = PHASES.reduce((n, p) => n + totals[p], 0);
  return (
    <section className={s.view} aria-label="Agents">
      <Card title={<><Icon name="plug" size={14} />Agents</>}
        aside={<>{all.length} {all.length === 1 ? "agent" : "agents"} · {subTotal} {subTotal === 1 ? "subagent" : "subagents"}</>}>
        <div className={s.head}>
          <ViewSwitch view={view} onChange={onView} />
          <div className={s.filters} role="group" aria-label="Filter subagents by state">
            <button type="button" className={cx(s.fbtn, filter === "all" && s.fon)} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All {subTotal}</button>
            {PHASES.map((p) => (
              <button key={p} type="button" className={cx(s.fbtn, filter === p && s.fon)} data-state={p} aria-pressed={filter === p} title={PHASE_HINT[p]}
                onClick={() => setFilter(filter === p ? "all" : p)}>{GLYPH[p]} {PHASE_LABEL[p]} {totals[p]}</button>
            ))}
          </div>
        </div>
      </Card>
      {cards.length === 0 ? (
        <p className={s.empty}>
          No agents match this filter
          <Button size="small" onClick={() => setFilter("all")}>Clear filter</Button>
        </p>
      ) : cards.map((c) => (
        <div key={c.session.sid} className={s.group}>
          <MainCard x={c.session} state={c.rows.main.state} name={c.rows.main.name} subs={c.rows.subs.length} onOpen={() => onOpenChat(c.session.sid)} />
          {c.rows.subs.length > 0 && (
            <ul className={s.grid} aria-label={`Subagents of ${c.rows.main.name}`}>
              {c.rows.subs.map((a, i) => (
                <li key={a.full || i} className={s.sub} data-state={a.state}>
                  <div className={s.subTop}>
                    <span className={s.tag} data-state={a.state} title={PHASE_HINT[a.state]}>{GLYPH[a.state]} {PHASE_LABEL[a.state]}</span>
                    <code>{a.type}</code>
                    {a.full && <Chip label={`#${a.code}`} text={a.full} what="agent id" title={`Copy the agent id ${a.full}`} />}
                  </div>
                  <p className={s.desc} title={a.desc}>{a.desc}</p>
                  <p className={s.subStats}>{a.model} · {a.ctx} · {a.turns}t · {a.out} out · {a.ago}</p>
                  <button type="button" className={s.parent} title="Open this subagent's chat" onClick={() => onOpenChat(c.session.sid)}>↗ {c.rows.main.name}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
