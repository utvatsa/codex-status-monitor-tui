// The overview: five small "stat panels" in the style of Grafana (a number, a note and a live chart that grows as samples
// arrive), a row of small usage gauges, what needs attention, and a "where and which model" row that doubles as a filter.
import { compact, plural } from "../lib/format";
import type { Session, Snapshot } from "../types";
import { Attention, cardItems } from "./Attention";
import { Machine } from "./Machine";
import { Chart } from "./Chart";
import { approvalOf, breakdown } from "./derive";
import { Count, Gauge, I } from "./parts";
import type { SeriesMap } from "./series";
import { mixText, tileFacts } from "../lib/tiles";

function Stat({ n, label, note, glyph, tip, children, chart, onOpen, openLabel }: { n: string; onOpen?: () => void; openLabel?: string; label: string; note?: React.ReactNode; glyph?: React.ReactNode; tip?: string; children: React.ReactNode; chart: React.ReactNode }) {
  return (
    <div className={`stat glass rise${onOpen ? " stat-link" : ""}`} title={tip}
      {...(onOpen ? {
        role: "button", tabIndex: 0, "aria-label": openLabel, onClick: onOpen,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); onOpen(); } },
      } : {})}>
      {onOpen && <span className="stat-go" aria-hidden="true">open <I name="chevron" size={12} /></span>}
      <div className="stat-top">
        <div className="stat-main"><span className="cell-l"><em aria-hidden="true">{n}</em>{label}</span><b className="cell-v">{children}</b><span className="cell-n">{note}</span></div>
        {glyph}
      </div>
      <div className="stat-chart">{chart}</div>
    </div>
  );
}

/** A slim proportion bar for counts that barely move (a chart of them says little): one segment per part, grown in when it first shows. */
function Mix({ parts, label }: { parts: [string, number, string][]; label: string }) {
  const total = parts.reduce((n, p) => n + p[1], 0);
  return (
    <div className="mix" role="img" aria-label={`${label}: ${parts.map(([k, n]) => `${n} ${k}`).join(", ")}`}>
      {total === 0 ? <i className="mix-empty" /> : parts.filter((p) => p[1] > 0).map(([k, n, c]) => <i key={k} title={`${n} ${k}`} style={{ flexGrow: n, background: c }} />)}
    </div>
  );
}

export function Hero({ snapshot: s, liveChats, series, showAccount, onAccount, minimal, query, onFilter, onPick, onArchived, onAgents }: {
  snapshot: Snapshot; liveChats: Session[]; series: SeriesMap; showAccount: boolean; onAccount: () => void; minimal: boolean;
  query: string; onFilter: (q: string) => void; onPick: (sid: string) => void; onArchived: (sid: string) => void; onAgents: () => void;
}) {
  const t = s.totals, h = t.health;
  const attn = cardItems(s).length > 0;
  const f = tileFacts(s), m = f.m, agents = { total: f.subagents.total, running: f.subagents.running };
  const worst = f.limit;
  const { hosts, models } = breakdown(liveChats);
  const approval = m.approval.length ? m.approval : approvalOf(liveChats);
  const q = query.trim().toLowerCase();
  const chip = (label: string, n: number, kind: "host" | "model") => (
    <button key={label} className="chip chip-btn" data-tone={kind === "host" ? "accent" : "violet"} aria-pressed={q === label.toLowerCase()}
      onClick={() => onFilter(q === label.toLowerCase() ? "" : label)} title={`Show only chats ${kind === "host" ? "running in" : "on"} ${label}`}>
      {label}<b>{n}</b>
    </button>
  );
  return (
    <>
      <div className="account rise">
        <h1>{s.account.email || "Unknown account"}</h1>
        <span className="chip" data-tone="accent">{s.account.plan || "?"}</span>
        <span className="chip">{s.account.tier || "?"}</span>
        <button className="btn" onClick={onAccount} aria-expanded={showAccount}>{showAccount ? "Hide details" : "Account details"}</button>
        <span className="when">{s.clock}</span>
      </div>
      {showAccount && <div className="account-more glass rise">{s.account.fields.map(([k, v]) => <div key={k}><span>{k}</span>{v}</div>)}</div>}

      <section className="stat-grid" aria-label="Overview">
        <Stat n="01" label="Threads" tip="A thread is one live Codex conversation (CLI session, IDE chat or desktop thread). Subagents are extra threads a thread started. Click to see them as agents."
          note={<span className="dots" title="Health of the live threads"><i data-h="OK" />{h.OK} ok<i data-h="AMBER" />{h.AMBER} amber<i data-h="RED" />{h.RED} red<span className="note-sub">{plural(agents.total, "subagent")} · {agents.running} running</span></span>}
          chart={<Mix label="Health of the live threads" parts={[["OK", h.OK, "var(--ok)"], ["AMBER", h.AMBER, "var(--warn)"], ["RED", h.RED, "var(--bad)"]]} />}
          onOpen={onAgents} openLabel="Open the Agents view">
          <Count value={t.live} />
        </Stat>
        <Stat n="02" label="Cache hit" tip="Share of input tokens served from the prompt cache. Higher means cheaper, faster turns." note={f.cacheText}
          chart={<Chart points={series.cache} format={(v) => `${Math.round(v)}%`} label="Cache hit rate" min={0} max={100} caption />}>
          {m.cache_pct === null ? "–" : <><Count value={m.cache_pct} /><small>%</small></>}
        </Stat>
        <Stat n="03" label="Reasoning" tip="Share of output tokens spent on reasoning rather than the visible answer. Set by the reasoning effort."
          note={m.effort.length ? `${f.reasoningText} · effort ${mixText(m.effort)}` : f.reasoningText}
          chart={<Chart points={series.reasoning} format={(v) => `${Math.round(v)}%`} label="Reasoning share of output" min={0} max={100} color="var(--accent-2)" caption />}>
          {m.reasoning_pct === null ? "–" : <><Count value={m.reasoning_pct} /><small>%</small></>}
        </Stat>
        <Stat n="04" label="Headroom" tip="Context window left in the tightest live thread." note={f.headroomChat ? `left in ${f.headroomChat}` : "no live thread"}
          chart={<Chart points={series.headroom} format={(v) => `${Math.round(v)}% left`} label="Context headroom" kind="step" min={0} max={100} marks={[15]} color={f.headroomLevel === "bad" ? "var(--bad)" : f.headroomLevel === "warn" ? "var(--warn)" : "var(--ok)"} caption />}>
          {f.headroom === null ? "–" : <><Count value={f.headroom} /><small>%</small></>}
        </Stat>
        <Stat n="05" label="Tokens / turn" tip="Average tokens per turn over the live threads: uncached input + cached input + output."
          note={`${plural(m.turns, "turn")} · ${compact(m.tokens)} tokens`}
          chart={<Chart points={series.tpt} format={compact} label="Tokens per turn" caption />}>
          {m.tokens_per_turn === null ? "–" : <Count value={m.tokens_per_turn} />}
        </Stat>
        <Stat n="06" label="Rate limit" note={worst ? `${worst.label} · resets in ${worst.resets}` : "no data"}
          chart={<Chart points={series.limit} format={(v) => `${Math.round(v)}%`} label="Busiest rate limit" min={0} max={100} marks={[85]} color="var(--warn)" caption />}>
          {worst ? <><Count value={worst.pct} /><small>%</small></> : "–"}
        </Stat>
      </section>

      {liveChats.length > 0 && (
        <div className="where rise" style={{ "--i": 2 } as React.CSSProperties}>
          <span className="where-l"><I name="terminal" size={14} />Running in</span>{hosts.map(([k, n]) => chip(k, n, "host"))}
          <span className="where-l" style={{ marginLeft: 8 }}><I name="cpu" size={14} />Model</span>{models.map(([k, n]) => chip(k, n, "model"))}
          <span className="where-l" style={{ marginLeft: 8 }}><I name="shield" size={14} />Approval</span>
          {approval.map(([k, n]) => <span key={k} className="chip" title={`${n} live ${n === 1 ? "thread" : "threads"} with approval policy ${k}`}>{k}<b className="chip-n">{n}</b></span>)}
        </div>
      )}

      <Machine alerts={s.system ?? []} onPick={onPick} onArchived={onArchived} />

      {!minimal && (
        <section className="hero2" aria-label="Limits and attention">
          <div className={`card glass rise ${attn ? "" : "full"}`} style={{ "--i": 3 } as React.CSSProperties}>
            <h3><I name="gauge" size={14} />Usage limits{s.usage.cached_ago && <span className="h3-n">{s.usage.stale ? "STALE · " : ""}cached {s.usage.cached_ago} ago</span>}</h3>
            <ul className="glims">
              {s.usage.limits.map((l) => (
                <li key={l.label}>
                  <Gauge pct={l.pct} size={54} />
                  <div><div className="lim-n">{l.label}{l.binding && <span className="chip" data-tone="warn">binding</span>}</div><div className="lim-r">resets in {l.resets}</div></div>
                </li>
              ))}
              {s.usage.limits.length === 0 && <li className="lim-r">No limit data in the Codex rollouts.</li>}
            </ul>
            {s.usage.pools.length > 0 && <div className="limit-foot">{s.usage.pools.map((p) => <span key={p}>{p}</span>)}</div>}
          </div>
          {attn && <Attention snapshot={s} series={series} />}
        </section>
      )}
    </>
  );
}
