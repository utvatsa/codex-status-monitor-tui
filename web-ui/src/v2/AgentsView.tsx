// The Agents view: what the top Agents tile opens. It replaces the chat list with agent cards (one per live chat) and, under each,
// a grid of subagent cards, so every agent can be seen at once with the chat it belongs to one click away.
import { useState } from "react";
import { agentCards, filterCards, PHASE_HINT, PHASE_LABEL, PHASES, phaseTotals, type AgentCard, type AgentFilter, type MainView } from "../lib/agents";
import { plural } from "../lib/format";
import type { Session } from "../types";
import { ctxTone, modelLabel } from "./derive";
import { GLYPH, PidChip, StateOrb, useFresh } from "./Agents";
import { CodeChip, I } from "./parts";

/** The `Chats | Agents` switch, in the style of the detail-level switch. */
export function ViewSwitch({ view, onView }: { view: MainView; onView: (v: MainView) => void }) {
  const views: MainView[] = ["chats", "agents"];
  return (
    <div className="seg" role="group" aria-label="Section">
      <span className="thumb" style={{ width: "calc((100% - 6px) / 2)", transform: `translateX(${views.indexOf(view) * 100}%)` }} />
      {views.map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => onView(v)}>{v}</button>)}
    </div>
  );
}

function SubCard({ a, parent, i, onOpen }: { a: AgentCard["rows"]["subs"][number]; parent: Session; i: number; onOpen: (sid: string) => void }) {
  const fresh = useFresh();
  const dim = a.state === "done" || a.state === "closed";
  return (
    <li className={`scard${dim ? " dim" : ""}${fresh ? " fresh" : ""}`} data-state={a.state} style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
      <div className="scard-top">
        <StateOrb state={a.state} label={PHASE_LABEL[a.state]} />
        <span className="sub-type">{a.type}</span>
        <CodeChip code={a.code} full={a.full} what="agent code" />
        <span className="sub-tag" data-state={a.state} title={PHASE_HINT[a.state]}><b aria-hidden="true">{GLYPH[a.state]}</b> {PHASE_LABEL[a.state]}</span>
      </div>
      <p className="scard-d" title={a.desc}>{a.desc || "no description"}</p>
      <div className="scard-s tnum">{modelLabel(a.model)} · {a.ctx} · {a.turns}t · {a.out} · {a.ago}</div>
      <button type="button" className="scard-p" onClick={() => onOpen(parent.sid)} title={`Open ${parent.label} in the details`} aria-label={`Open chat ${parent.label}`}>↗ {parent.label}</button>
    </li>
  );
}

function AgentCardView({ c, i, onOpen }: { c: AgentCard; i: number; onOpen: (sid: string) => void }) {
  const fresh = useFresh();
  const x = c.session, m = c.rows.main, t = ctxTone(x);
  return (
    <section className={`acard glass${fresh ? " fresh" : ""}`} data-state={m.state} data-sid={x.sid} aria-label={`Agent ${m.name}`} style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
      <div className="acard-h">
        <StateOrb state={m.state} />
        <h3>{m.name}</h3>
        <span className="ag-kind">main agent</span>
        <CodeChip code={m.code} full={m.sid} what="session id" />
        {m.pid != null && <PidChip pid={m.pid} />}
        <span className="chip" data-tone="violet" title="Model"><I name="cpu" size={12} />{modelLabel(m.model)}</span>
        <span className="ag-word" data-state={m.state}>{m.state}{x.waiting ? "*" : ""}</span>
        <button type="button" className="btn acard-open" onClick={() => onOpen(x.sid)} aria-label={`Open chat ${m.name}`}>Open chat <I name="chevron" size={13} /></button>
      </div>
      <div className="acard-m">
        <div className="ctx" title={`last turn's input (cached included): ${x.ctx} of a ${x.window} window`}>
          <div className="ctx-top"><b className="tnum">{x.ctx_pct}%{x.maybe_1m ? "~" : ""}</b><span className="tnum">{x.ctx} / {x.window}</span></div>
          <div className="ctx-bar" data-t={t} role="meter" aria-label="context window" aria-valuenow={x.ctx_pct} aria-valuemin={0} aria-valuemax={100}><i style={{ "--p": Math.min(100, x.ctx_pct) } as React.CSSProperties} /></div>
        </div>
        <span className="acard-f tnum">{m.mem ? `mem ${m.mem}MB · ` : ""}last {m.last}</span>
      </div>
      {c.rows.subs.length === 0
        ? <p className="acard-none">no subagents</p>
        : <ul className="sgrid" aria-label={`Subagents of ${m.name}`}>{c.rows.subs.map((a, k) => <SubCard key={a.full} a={a} parent={x} i={k} onOpen={onOpen} />)}</ul>}
    </section>
  );
}

interface Props {
  sessions: Session[]; live: Session[]; query: string; view: MainView;
  onView: (v: MainView) => void; onOpen: (sid: string) => void; onClearQuery: () => void;
}

export function AgentsView({ sessions, live, query, view, onView, onOpen, onClearQuery }: Props) {
  const [filter, setFilter] = useState<AgentFilter>("all");
  const all = agentCards(sessions);
  const totals = phaseTotals(all);
  // The page filter chips (Running in / model) match fields the helper does not know, so a chat the page's own filter lets through is kept as well.
  const bySearch = filterCards(all, filter, query), byChat = filterCards(all.filter((c) => live.some((x) => x.sid === c.session.sid)), filter, "");
  const cards = all.map((c) => bySearch.find((b) => b.session.sid === c.session.sid) ?? byChat.find((b) => b.session.sid === c.session.sid)).filter((c): c is AgentCard => !!c);
  const subs = cards.reduce((n, c) => n + c.rows.subs.length, 0);
  const clear = () => { setFilter("all"); onClearQuery(); };
  return (
    <section aria-label="Agents">
      <div className="ch-bar">
        <h2>Agents</h2>
        <ViewSwitch view={view} onView={onView} />
        <span className="count">{plural(cards.length, "agent")} · {plural(subs, "subagent")}{query.trim() ? ` · filter “${query.trim()}”` : ""}</span>
      </div>
      <div className="afilter" role="group" aria-label="Subagent state">
        <button type="button" className="chip chip-btn" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
        {PHASES.map((p) => (
          <button key={p} type="button" className="chip chip-btn sub-count" data-state={p} aria-pressed={filter === p} title={PHASE_HINT[p]} onClick={() => setFilter(filter === p ? "all" : p)}>
            <span aria-hidden="true">{GLYPH[p]}</span> {PHASE_LABEL[p]}<b>{totals[p]}</b>
          </button>
        ))}
      </div>
      {cards.length === 0 ? (
        <div className="aempty glass"><p>No agents match this filter.</p><button type="button" className="btn" onClick={clear}>Clear the filter</button></div>
      ) : (
        <div className="acards">{cards.map((c, i) => <AgentCardView key={c.session.sid} c={c} i={i} onOpen={onOpen} />)}</div>
      )}
    </section>
  );
}
