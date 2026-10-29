// Small additions for the agents: a pid chip, compact subagent lines under a chat row, and the short main-agent list of the top
// Agents panel. Subagents have no pid (they run inside the chat's process): each is told apart by its agent code.
import { useEffect, useId, useState } from "react";
import { agentRows, listStartsOpen, PHASE_HINT, PHASE_LABEL, PHASES, subCounts, type AgentRows, type AgentState, type SubAgent } from "../lib/agents";
import type { SubPhase } from "../types";
import { copyText } from "../lib/clipboard";
import type { Session } from "../types";
import { modelLabel } from "./derive";
import { CodeChip, I, useToast } from "./parts";

/** True for a moment after the element is first created. An entrance animation tied to this plays once, when the element appears; moving the
 *  element (rows swap places when the list re-sorts) keeps the component mounted, so the animation does not replay and nothing flashes. */
export function useFresh(ms = 900): boolean {
  const [fresh, setFresh] = useState(true);
  useEffect(() => { const t = setTimeout(() => setFresh(false), ms); return () => clearTimeout(t); }, [ms]);
  return fresh;
}

/** A small dot coloured by state: green and breathing = working now, amber = waiting on you, grey = idle. */
export const StateOrb = ({ state, label }: { state: AgentState | SubPhase; label?: string }) => (
  <span className="sorb" data-state={state} role="img" aria-label={label ?? state} title={label ?? state} />
);

/** The chat's pid in the style of the code chips; clicking copies it. */
export function PidChip({ pid }: { pid: number }) {
  const toast = useToast();
  return (
    <button type="button" className="chip code" title="process id of this chat (its subagents run inside it)  ·  click to copy" aria-label={`Copy pid ${pid}`}
      onClick={async (e) => { e.stopPropagation(); toast((await copyText(String(pid))) ? "Copied the pid" : "Copy failed"); }}>
      pid {pid}
    </button>
  );
}

export const GLYPH: Record<SubPhase, string> = { active: "●", idle: "●", done: "✓", closed: "⊘" };

/** Open or closed per chat, kept by session id (so it survives refreshes and re-sorting); until the user toggles, `initial(rows)` decides. */
export function useSubOpen(initial: (rows: AgentRows) => boolean = listStartsOpen) {
  const [choice, setChoice] = useState<Record<string, boolean>>({});
  return {
    isOpen: (sid: string, rows: AgentRows) => choice[sid] ?? initial(rows),
    toggle: (sid: string, rows: AgentRows) => setChoice((c) => ({ ...c, [sid]: !(c[sid] ?? initial(rows)) })),
  };
}

/** The subagents of a chat: a header (chevron, count, how many are in each state) that folds the list, then one compact line per subagent. */
export function SubLines({ session, open, onToggle }: { session: Session; open: boolean; onToggle: () => void }) {
  const rows = agentRows(session);
  const id = useId();
  // The lines stay mounted while the fold-up animation plays, and are mounted one render after opening so the height grows from 0.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), 240);
    return () => clearTimeout(t);
  }, [open]);
  if (rows.subs.length === 0) return null;
  const c = subCounts(rows);
  return (
    <div className="subs2" data-open={open ? "" : undefined}>
      <button type="button" className="subs2-h" aria-expanded={open} aria-controls={id}
        onClick={(e) => { e.stopPropagation(); onToggle(); }} title={open ? "Hide the subagents" : "Show the subagents"}>
        <span className="subs2-chev"><I name="chevron" size={13} /></span>
        <span className="subs2-t">subagents ({rows.subs.length})</span>
        {PHASES.filter((p) => c[p] > 0).map((p) => <span key={p} className="sub-count" data-state={p} title={PHASE_HINT[p]}><b aria-hidden="true">{GLYPH[p]}</b> {c[p]} {PHASE_LABEL[p]}</span>)}
      </button>
      <div className="subs2-wrap" id={id} data-open={open && mounted ? "" : undefined} aria-hidden={!open}>
        <div className="subs2-in">
          {mounted && (
            <ul className="sublines" aria-label="Subagents">
              {rows.subs.map((a, i) => <SubLine key={a.full} a={a} i={i} />)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function SubLine({ a, i }: { a: SubAgent; i: number }) {
  const fresh = useFresh();
  return (
    <li className={`subline${a.state === "done" || a.state === "closed" ? " dim" : ""}${fresh ? " fresh" : ""}`} data-state={a.state} style={{ "--i": Math.min(i, 6) } as React.CSSProperties}>
      <StateOrb state={a.state} label={PHASE_LABEL[a.state]} />
      <span className="sub-type">{a.type}</span>
      <CodeChip code={a.code} full={a.full} what="agent code" />
      <span className="sub-tag" data-state={a.state} title={PHASE_HINT[a.state]}><b aria-hidden="true">{GLYPH[a.state]}</b> {PHASE_LABEL[a.state]}</span>
      <span className="sub-desc" title={a.desc}>{a.desc || "no description"}</span>
      <span className="sub-stats tnum">{modelLabel(a.model)} · {a.ctx} · {a.turns}t · {a.out} · {a.ago}</span>
    </li>
  );
}

const RANK: Record<AgentState, number> = { active: 0, waiting: 1, idle: 2, ended: 3 };

/** Up to 3 live main agents (active, then waiting, then idle): orb, name and a green "+k running". Click opens the chat. */
export function MainAgents({ chats, onPick, max = 3 }: { chats: Session[]; onPick: (sid: string) => void; max?: number }) {
  const all = chats.filter((x) => x.active).map(agentRows).sort((a, b) => RANK[a.main.state] - RANK[b.main.state]);
  if (all.length === 0) return <p className="agp-empty">No chat is running.</p>;
  return (
    <ul className="agp" aria-label="Main agents">
      {all.slice(0, max).map((r) => (
        <li key={r.main.sid} data-state={r.main.state}>
          <button type="button" className="agp-main" onClick={(e) => { e.stopPropagation(); onPick(r.main.sid); }} aria-label={`Open ${r.main.name}`} title={`Open ${r.main.name} in the details`}>
            <StateOrb state={r.main.state} />
            <span className="agp-name">{r.main.name}</span>
            {r.running > 0 && <small className="agp-run">+{r.running} running</small>}
          </button>
        </li>
      ))}
      {all.length > max && <li className="agp-more">+{all.length - max} more chats</li>}
    </ul>
  );
}
