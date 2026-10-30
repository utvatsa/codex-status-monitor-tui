// The chat list. One container holds every row, and a single "lens" element glides to whichever row is highlighted
// (measured from the DOM, moved with a CSS transform, so it springs from row to row instead of jumping).
import { useLayoutEffect, useRef, useState } from "react";
import { plural } from "../lib/format";
import { LEVEL_REPS, VIEWS, viewIndex, type Flags } from "../lib/view";
import type { Session, Snapshot } from "../types";
import { agentCode, ctxMarks, ctxTone, modelLabel, sessionCode } from "./derive";
import { DiskBreakdown, DiskChip, Housekeeping } from "./Footprint";
import { CodeChip, CopyBtn, I, Kbd, Orb } from "./parts";
import { PidChip, SubLines, useFresh, type useSubOpen } from "./Agents";
import { agentRows, type MainView } from "../lib/agents";
import { ViewSwitch } from "./AgentsView";

type F = Flags & { level: number; arcPrompt: boolean; allSubagents: boolean };

interface RowProps {
  x: Session; n: number; f: F; open: boolean;
  onPick: (id: string) => void; onToggle: (id: string) => void;
  subOpen: boolean; onSub: () => void;
}

/** The body of an expanded row. Its entrance fade plays once, when it is created; moving the row (a re-sort) must not replay it. */
function RowMore({ children }: { children: React.ReactNode }) {
  const fresh = useFresh();
  return <div className={`row-more${fresh ? " fresh" : ""}`}>{children}</div>;
}

function Row({ x, n, f, open, onPick, onToggle, subOpen, onSub }: RowProps) {
  const t = ctxTone(x);
  const rich = !f.compact && (x.active || open);        // standard and full views show stats and reasons under the row
  const showMore = rich || open;
  const marks = ctxMarks(x);
  return (
    <div className="row" data-sid={x.sid} data-live={x.active} data-h={x.health} data-compact={f.compact || undefined} role="option" aria-selected={false}
      onClick={() => onPick(x.sid)} style={{ "--i": n } as React.CSSProperties}>
      <div className="row-main">
        <span className="row-n tnum">{n}</span>
        <div className="row-t">
          <div className="row-title"><Orb health={x.health} live={x.active} />
            <span style={{ marginLeft: 8 }}>{x.name || x.label}</span>{x.title && x.title !== (x.name || x.label) && <em> · {x.title}</em>}
          </div>
          <div className="ident">
            <span className="chip" data-tone="accent" title={`Where it runs: ${x.running_in}`}><I name={x.source === "terminal" || /CLI/.test(x.running_in) ? "terminal" : "chat"} size={12} />{x.running_in}</span>
            <span className="chip" data-tone="violet" title="Model"><I name="cpu" size={12} />{modelLabel(x.model)}</span>
            <CodeChip code={sessionCode(x.sid)} full={x.sid} what="session id" />
            {x.pid != null && <PidChip pid={x.pid} />}
            <DiskChip x={x} />
            {x.subagents.length > 0 && (
              <span className="chip" data-tone={x.subagents.some((a) => a.running) ? "ok" : undefined}
                title={`${x.subagents.length} subagents started by this chat; open the details to see each one`}>
                <I name="cpu" size={12} />{plural(x.subagents.length, "subagent")}{x.subagents.some((a) => a.running) ? ` · ${x.subagents.filter((a) => a.running).length} running` : ""}
              </span>
            )}
            <span className="state" data-s={x.state.replace("?", "")} title={x.waiting ? `waiting on a permission prompt (${x.waiting})` : undefined}><i />{x.state}{x.waiting ? "*" : ""}</span>
            <span className="when">{x.active ? `last ${x.last}` : `ended ${x.last} ago`}</span>
          </div>
        </div>
        <div className="ctx" title={`last turn's input (cached included): ${x.ctx} of a ${x.window} window · alerts at ${x.ctx_amber} / ${x.ctx_red}`}>
          <div className="ctx-top"><b className="tnum">{x.ctx_pct}%{x.maybe_1m ? "~" : ""}</b><span className="tnum">{x.ctx} / {x.window}</span></div>
          <div className="ctx-bar" data-t={t} role="meter" aria-label="context window" aria-valuenow={x.ctx_pct} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ "--p": Math.min(100, x.ctx_pct) } as React.CSSProperties} />
            {marks.map((m, i) => <u key={i} data-k={i ? "red" : "amber"} title={`${i ? "red" : "amber"} from ${m}%`} style={{ left: `${m}%` }} />)}
          </div>
        </div>
        <div className="row-end">
          {x.health !== "OK" && <span className="chip" data-tone={x.health === "RED" ? "bad" : "warn"}>{x.health}</span>}
          <CopyBtn text={x.resume} what="resume command" />
          <button className="btn" data-icon="" aria-label={open ? "Collapse" : "Expand"} aria-expanded={open}
            onClick={(e) => { e.stopPropagation(); onToggle(x.sid); }}>
            <span style={{ display: "inline-flex", transition: "transform .3s var(--spring)", transform: open ? "rotate(180deg)" : "none" }}><I name="chevron" /></span>
          </button>
        </div>
      </div>
      {showMore && (
        <RowMore>
          {(x.why.length > 0 || x.active) && <div className="row-why" data-h={x.health}>{x.why.length ? x.why.join(" · ") : "Nothing needs attention"}</div>}
          <div className="stats">
            <span>turns<b className="tnum">{x.turns}</b></span><span>out<b className="tnum">{x.out}</b></span>
            <span>in<b className="tnum">{x.inp}</b></span><span>cached<b className="tnum">{x.cache_r}</b></span><span>reasoning<b className="tnum">{x.reasoning}</b></span>
            {x.mem_mb ? <span>mem<b className="tnum">{x.mem_mb}MB</b></span> : null}
            {x.subagents.length > 0 && <span>subagents<b className="tnum">{x.subagents.filter((a) => a.running).length}/{x.subagents.length}</b></span>}
          </div>
          <SubLines session={x} open={subOpen} onToggle={onSub} />
          <DiskBreakdown x={x} />
          <Housekeeping x={x} />
          {f.verbose && x.subagents.length > 0 && (
            <div className="subs"><span>subagents</span>
              {(f.allSubagents ? x.subagents : x.subagents.slice(0, 3)).map((a) => (
                <span key={a.code} className="chip" data-tone={a.running ? "ok" : undefined} title={a.desc}>{a.type} · #{agentCode(a.code)}{a.running ? " · running" : ""}</span>
              ))}
              {!f.allSubagents && x.subagents.length > 3 && <span className="when">+{x.subagents.length - 3} more in the details</span>}
            </div>
          )}
          {!f.noPrompts && x.first_prompt && <div className="prompt one"><span>first</span>{x.first_prompt}</div>}
          {!f.noPrompts && x.latest_prompt && <div className="prompt one"><span>latest</span>{x.latest_prompt}</div>}
          {x.active === false && f.arcPrompt && f.noPrompts && x.latest_prompt && <div className="prompt one"><span>latest</span>{x.latest_prompt}</div>}
        </RowMore>
      )}
    </div>
  );
}

interface Props {
  snapshot: Snapshot; live: Session[]; archived: Session[]; f: F;
  cursor: string | null; picked: boolean; expanded: Record<string, true>; query: string;
  onPick: (id: string) => void; onToggle: (id: string) => void;
  onLevel: (level: number) => void; onFlag: (flag: "showArc" | "noPrompts" | "compact") => void;
  onQuery: (q: string) => void; searchRef: React.Ref<HTMLInputElement>;
  view: MainView; onView: (v: MainView) => void;
  subs: ReturnType<typeof useSubOpen>;      // each chat's open/closed choice for its subagent list, owned by the app so it survives leaving the chat list
}

export function Chats({ snapshot, live, archived, f, cursor, picked, expanded, query, onPick, onToggle, onLevel, onFlag, onQuery, searchRef, view, onView, subs }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [lens, setLens] = useState<{ y: number; h: number } | null>(null);
  const vi = viewIndex(f.level);
  let n = 0;

  // Measure the highlighted row and move the lens there (after layout, before paint, so it never flashes in the wrong place). It runs after
  // EVERY render, because the row can move without its id or size changing (the list is sorted by last activity, so two busy chats swap
  // places on a refresh), and it only stores a new value when the numbers differ, so it cannot loop. The observer covers size changes that
  // happen without a render (fonts, an animation, the window).
  const find = () => (cursor ? box.current?.querySelector<HTMLElement>(`[data-sid="${CSS.escape?.(cursor) ?? cursor}"]`) : null);
  // `follow`: the change came from the row resizing under the lens (a subagent list folding), so the lens must not glide behind it.
  const [follow, setFollow] = useState(false);
  const lensEl = useRef<HTMLDivElement>(null);
  const measure = (fromResize = false) => {
    setFollow(fromResize === true);
    const el = find();
    const next = el ? { y: el.offsetTop, h: el.offsetHeight } : null;
    if (fromResize === true && next && lensEl.current) {      // move it right now, in the same frame as the resize, not after React's next render
      lensEl.current.setAttribute("data-follow", "");
      lensEl.current.style.transform = `translateY(${next.y}px)`;
      lensEl.current.style.height = `${next.h}px`;
    }
    setLens((prev) => (prev === next || (prev && next && prev.y === next.y && prev.h === next.h) ? prev : next));
  };
  useLayoutEffect(() => measure());
  useLayoutEffect(() => {
    let first = true;                                    // the observer reports once when it starts: that is not a resize
    const ro = typeof ResizeObserver !== "undefined" && box.current ? new ResizeObserver(() => { if (first) { first = false; return; } measure(true); }) : null;
    if (ro && box.current) ro.observe(box.current);
    const row = find();
    if (ro && row) ro.observe(row);
    return () => ro?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, live.length, archived.length]);

  const rowProps = (x: Session): RowProps => ({ x, n: ++n, f, open: !!expanded[x.sid], onPick, onToggle, subOpen: subs.isOpen(x.sid, agentRows(x)), onSub: () => subs.toggle(x.sid, agentRows(x)) });

  return (
    <section aria-label="Chats">
      <div className="ch-bar">
        <h2>Chats</h2><ViewSwitch view={view} onView={onView} /><span className="count">{plural(live.length, "live chat")}{f.showArc ? ` · ${archived.length} archived` : ""}</span>
        <div className="ch-tools">
          <div className="seg" role="group" aria-label="Detail level">
            <span className="thumb" style={{ width: `calc((100% - 6px) / ${VIEWS.length})`, transform: `translateX(${vi * 100}%)` }} />
            {VIEWS.map((v, i) => <button key={v} aria-pressed={vi === i} onClick={() => onLevel(LEVEL_REPS[i])}>{v}</button>)}
          </div>
          <button className="toggle" aria-pressed={f.showArc} onClick={() => onFlag("showArc")}><i />Archived</button>
          <button className="toggle" aria-pressed={!f.noPrompts} onClick={() => onFlag("noPrompts")}><i />Prompts</button>
          <div className="filter">
            <I name="search" size={15} />
            <input ref={searchRef} value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Filter chats" aria-label="Filter chats" />
            <Kbd>/</Kbd>
          </div>
        </div>
      </div>

      <div className="list glass" ref={box} role="listbox" aria-label="Chats">
        <div className="lens" ref={lensEl} data-on={lens ? "" : undefined} data-follow={follow ? "" : undefined} data-picked={picked ? "" : undefined}
          style={lens ? { transform: `translateY(${lens.y}px)`, height: lens.h } : undefined} />
        {snapshot.view.show_live && (
          <>
            <div className="sec-h"><I name="chat" size={13} />Live<span>a process is running; idle ones still hold memory</span></div>
            {live.length === 0 ? <p className="empty">{query ? "No live chat matches the filter." : "No chat is running."}</p>
              : live.map((x) => <Row key={x.sid} {...rowProps(x)} />)}
          </>
        )}
        {f.showArc && (
          <>
            <div className="sec-h"><I name="archive" size={13} />Archived and ended<span>{snapshot.view.has_arc ? `last ${snapshot.view.days} days` : "reading…"}</span></div>
            {!snapshot.view.has_arc ? <p className="empty">Reading archived chats…</p>
              : archived.length === 0 ? <p className="empty">{query ? "No archived chat matches the filter." : `None in the last ${snapshot.view.days} days.`}</p>
              : archived.map((x) => <Row key={x.sid} {...rowProps(x)} />)}
            {snapshot.view.hidden > 0 && <p className="hidden-note">{plural(snapshot.view.hidden, "older archived chat")} not shown: start with <code>-n 0</code> for all, <code>-d DAYS</code> to widen.</p>}
          </>
        )}
      </div>
    </section>
  );
}
