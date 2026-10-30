// The detail drawer: a glass panel that slides in from the right for the selected chat (a bottom sheet on narrow screens).
// It is not modal: the list keeps working behind it, and the highlighted chat's details follow the arrow keys.
import type { Session } from "../types";
import { agentCode, modelLabel, sessionCode } from "./derive";
import { Chart } from "./Chart";
import { DiskBreakdown, Housekeeping } from "./Footprint";
import { WindowControl } from "./WindowControl";
import { CodeChip, CopyBtn, Gauge, I, Orb } from "./parts";
import type { SeriesMap } from "./series";

export function Drawer({ x, open, onClose, series }: { x: Session | undefined; open: boolean; onClose: () => void; series: SeriesMap }) {
  const running = x ? x.subagents.filter((a) => a.running).length : 0;
  return (
    <aside className="dr glass glass-strong" data-open={open && x ? "" : undefined} aria-label="Chat details" aria-hidden={!(open && x)}>
      {x && (
        <>
          <div className="dr-head">
            <Orb health={x.health} live={x.active} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2>{x.name || x.label}</h2>
              <p>{x.title}</p>
            </div>
            <button className="btn" data-icon="" onClick={onClose} aria-label="Close details" title="Close (Esc)"><I name="close" /></button>
          </div>
          <div className="dr-body" key={x.sid}>
            <section aria-label="Runtime">
              <h4>Runtime</h4>
              <div className="facts">
                <div className="fact big" data-tone="accent"><span>Running in</span><b><I name={/CLI/.test(x.running_in) ? "terminal" : "chat"} size={15} />{x.running_in}</b></div>
                <div className="fact big" data-tone="violet"><span>Model</span><b><I name="cpu" size={15} />{modelLabel(x.model)}</b></div>
                <div className="fact"><span>State</span><b>{x.state}{x.waiting ? "*" : ""}</b></div>
                <div className="fact"><span>{x.active ? "Up" : "Ended"}</span><b className="tnum">{x.active ? x.up : `${x.last} ago`}</b></div>
                <div className="fact"><span>Process</span><b className="tnum">{x.pid ? `pid ${x.pid}` : "none"}{x.mem_mb ? ` · ${x.mem_mb}MB` : ""}</b></div>
                <div className="fact wide"><span>Folder</span><b className="mono">{x.folder}</b></div>
              </div>
            </section>

            {x.active && (
              <section aria-label="Memory">
                <h4>Memory over time</h4>
                <Chart points={series[`mem:${x.sid}`]} format={(v) => `${Math.round(v)} MB`} label="Memory over time" height={54} color="var(--accent-2)" caption />
              </section>
            )}

            <section aria-label="Session code">
              <h4>Session code</h4>
              <div className="codebox">
                <span className="code-big"><span className="code-h">#</span>{sessionCode(x.sid)}<small>{x.sid.slice(8)}</small></span>
                <CopyBtn text={x.sid} what="session id" label="Copy id" />
              </div>
              <p className="note">The code is the first 8 characters of the session id. <code>codex resume</code> needs the full id, so Copy uses that.</p>
            </section>

            <section aria-label="Context">
              <h4>Context window</h4>
              <div className="ctx-top2">
                <Gauge pct={x.ctx_pct} size={64} />
                <div className="ctx-row"><b className="tnum">{x.ctx}<small> of {x.window}{x.maybe_1m ? " (may be 1M)" : ""}</small></b><span className="tnum">{x.turns} turns · in {x.inp} · cached {x.cache_r} · out {x.out} (reasoning {x.reasoning})</span></div>
              </div>
              <WindowControl x={x} />
              <Chart points={series[`ctx:${x.sid}`]} format={(v) => `${Math.round(v)}%`} label="Context over time" height={64} min={0} max={100} marks={[x.ctx_amber_pct, x.ctx_red_pct]} color="var(--accent)" caption />
              <p style={{ margin: "10px 0 0", fontSize: 13, color: x.why.length ? (x.health === "RED" ? "var(--bad)" : "var(--warn)") : "var(--text-3)" }}>
                {x.why.length ? x.why.join(" · ") : "Nothing needs attention."}
              </p>
              {x.tips.length > 0 && <ul className="tips" style={{ marginTop: 8 }}>{x.tips.map((t) => <li key={t}>{t}</li>)}</ul>}
            </section>

            {(x.files || x.advice.length > 0) && (
              <section aria-label="Disk and housekeeping">
                <h4>Disk</h4>
                <DiskBreakdown x={x} />
                <Housekeeping x={x} />
              </section>
            )}

            <section aria-label="Agents">
              <h4>Agents<span className="h4-n">{1 + x.subagents.length} total · {(x.active ? 1 : 0) + running} running</span></h4>
              <ul className="agents">
                <li data-run={x.active || undefined}>
                  <span className="ag-top">
                    <CodeChip code={sessionCode(x.sid)} full={x.sid} what="session id" />
                    <span className="chip" data-tone="violet">main agent</span>
                    <span className="ag-s">{x.state}{x.waiting ? "*" : ""}</span>
                  </span>
                  <span className="ag-d">This chat itself{x.title ? `: ${x.title}` : ""}</span>
                  <span className="ag-m">{x.model} · {x.ctx} context</span>
                </li>
                  {x.subagents.map((a) => (
                    <li key={a.code} data-run={a.running || undefined}>
                      <span className="ag-top">
                        <CodeChip code={agentCode(a.code)} full={a.code} what="agent code" />
                        <span className="chip" data-tone="accent">{a.type}</span>
                        <span className="ag-s">{a.phase ?? (a.running ? "active" : "done")} · {a.ago}</span>
                      </span>
                      <span className="ag-d">{a.desc || "no description"}</span>
                      <span className="ag-m">{a.model} · {a.ctx} context</span>
                    </li>
                  ))}
              </ul>
              {x.subagents.length === 0 && <p className="note" style={{ marginTop: 8 }}>No subagents started by this chat.</p>}
              <p className="note">Agent code = the agent's id, the file <code>subagents/agent-&lt;code&gt;.jsonl</code> next to this session's transcript. Type says what kind of agent it is (Plan, Explore, general-purpose…). Newest first.</p>
            </section>

            <section aria-label="Commands">
              <h4>Resume</h4>
              <div className="cmd"><code>{x.resume}</code><CopyBtn text={x.resume} what="resume command" /></div>
              {x.active && <p className="note">Live in {x.running_in}: close it there first, or add --fork-session.</p>}
              <h4 style={{ marginTop: 14 }}>Fresh chat in the same folder</h4>
              <div className="cmd"><code>{x.clean}</code><CopyBtn text={x.clean} what="fresh-chat command" /></div>
            </section>

            {(x.first_prompt || x.latest_prompt) && (
              <section aria-label="Prompts">
                <h4>Prompts</h4>
                {x.first_prompt && <div className="dr-prompt"><span className="chip" style={{ marginBottom: 6 }}>first</span><br />{x.first_prompt}</div>}
                {x.latest_prompt && <div className="dr-prompt" style={{ marginTop: 8 }}><span className="chip" style={{ marginBottom: 6 }}>latest</span><br />{x.latest_prompt}</div>}
              </section>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
