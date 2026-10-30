// The top of the page: who you are, four headline numbers, usage limits and anything that needs attention.
import { useMemo, useState, type ReactNode } from "react";
import type { Session, Snapshot, WindowOffer } from "../types";
import { attentionItems, type AttentionKind } from "../lib/attention";
import { compact, plural } from "../lib/format";
import { limitLevel, mixText, tileFacts } from "../lib/tiles";
import { parseSize } from "../lib/settings";
import { Card } from "./ui/Card";
import { Icon } from "./ui/Icon";
import { Badge, Button, CopyButton, Meter, cx } from "./ui/primitives";
import { WindowEditor } from "./WindowControl";
import s from "./Overview.module.css";

export function AccountLine({ snapshot, showAccount, onToggle }: { snapshot: Snapshot; showAccount: boolean; onToggle: () => void }) {
  const a = snapshot.account;
  return (
    <div className={s.account}>
      <div className={s.who}>
        <h1>{a.email ?? "Unknown account"}</h1>
        <span className={s.plan}>{a.plan ?? "?"} · {a.tier ?? "?"}</span>
      </div>
      <div className={s.when}>
        <span>{snapshot.clock}</span>
        <Button variant="ghost" size="small" onClick={onToggle} aria-expanded={showAccount}>{showAccount ? "Hide account" : "Account details"}</Button>
      </div>
      {showAccount && (
        <dl className={s.fields}>
          {a.fields.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
      )}
    </div>
  );
}

type Level = "good" | "warn" | "bad";

/** A readout tile: index and caption in mono caps, a big numeral, a segmented bar and a note line. */
function Tile({ n, label, value, unit, bar, level, children, onOpen, openLabel, tip }: { n: string; label: string; value: ReactNode; unit?: string; bar?: ReactNode; level?: Level; children?: ReactNode; onOpen?: () => void; openLabel?: string; tip?: string }) {
  return (
    <div className={cx(s.tile, level && level !== "good" && s[level], onOpen && s.tileBtn)} title={tip}
      {...(onOpen ? { role: "button", tabIndex: 0, "aria-label": openLabel, onClick: onOpen,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } } } : {})}>
      <div className={s.tileHead}><span>{label}</span><i aria-hidden="true">{n}</i></div>
      <div className={cx(s.kpi, "tnum")}>{value}{unit && <small>{unit}</small>}</div>
      {bar && <div className={s.tileBar}>{bar}</div>}
      {children && <div className={s.tileFoot}>{children}</div>}
    </div>
  );
}

/** Proportional segmented bar for counts and shares (threads by health, tokens by kind). */
function Split({ parts, label }: { parts: [string, number, string][]; label: string }) {
  const total = parts.reduce((x, p) => x + p[1], 0);
  return (
    <span className={s.split} role="img" aria-label={`${label}: ${parts.map(([k, v]) => `${v} ${k}`).join(", ")}`}>
      {total === 0 ? <i className={s.splitEmpty} /> : parts.filter((p) => p[1] > 0).map(([k, v, c]) => <i key={k} title={`${v} ${k}`} style={{ flexGrow: v, background: c }} />)}
    </span>
  );
}

export function KpiTiles({ snapshot, onOpenAgents }: { snapshot: Snapshot; showArc?: boolean; onOpenAgents?: () => void }) {
  const t = snapshot.totals;
  const f = tileFacts(snapshot);
  const m = f.m;
  const attention = t.health.AMBER + t.health.RED;
  const lim = f.limit;
  return (
    <div className={s.tiles}>
      <Tile n="01" label="Threads" value={t.live} level={t.health.RED ? "bad" : attention ? "warn" : undefined} onOpen={onOpenAgents} openLabel="Open the Agents view"
        tip="A thread is one live Codex conversation (CLI session, IDE chat or desktop thread). Click to see them as agents."
        bar={<Split label="Health of the live threads" parts={[["OK", t.health.OK, "var(--good)"], ["AMBER", t.health.AMBER, "var(--warn)"], ["RED", t.health.RED, "var(--bad)"]]} />}>
        <span className={s.healthRow}>
          {(["OK", "AMBER", "RED"] as const).map((k) => (
            <span key={k} className={s.hm} data-h={k} aria-label={`${t.health[k]} ${k}`}><i aria-hidden="true" /><b className="tnum">{t.health[k]}</b>{k.toLowerCase()}</span>
          ))}
        </span>
        <span>{plural(f.subagents.total, "subagent")} · {f.subagents.running} running</span>
      </Tile>
      <Tile n="02" label="Cache hit" value={m.cache_pct ?? "–"} unit={m.cache_pct === null ? undefined : "%"}
        tip="Share of input tokens served from the prompt cache. Higher means cheaper, faster turns."
        bar={m.cache_pct === null ? undefined : <Meter pct={m.cache_pct} label="Prompt cache hit rate" tone="good" />}>
        <span>{f.cacheText}</span>
      </Tile>
      <Tile n="03" label="Reasoning" value={m.reasoning_pct ?? "–"} unit={m.reasoning_pct === null ? undefined : "%"}
        tip="Share of output tokens spent on reasoning rather than the visible answer. Set by the reasoning effort."
        bar={m.reasoning_pct === null ? undefined : <Meter pct={m.reasoning_pct} label="Reasoning share of output" tone="good" />}>
        <span>{f.reasoningText}</span>
        <span>{m.effort.length ? `effort ${mixText(m.effort)}` : "effort not reported"}</span>
      </Tile>
      <Tile n="04" label="Headroom" value={f.headroom ?? "–"} unit={f.headroom === null ? undefined : "%"} level={f.headroomLevel}
        tip="Context window left in the tightest live thread. Codex compacts or loses detail when it runs out."
        bar={f.headroom === null ? undefined : <Meter pct={f.headroom} label="Context headroom of the tightest thread" tone={f.headroomLevel} />}>
        <span>{f.headroomChat ? `left in ${f.headroomChat}` : "no live thread"}</span>
      </Tile>
      <Tile n="05" label="Tokens / turn" value={m.tokens_per_turn === null ? "–" : compact(m.tokens_per_turn)}
        tip="Average tokens per turn over the live threads: uncached input + cached input + output."
        bar={<Split label="Tokens by kind" parts={[["fresh input", m.fresh_input, "var(--accent)"], ["cached", m.cached, "var(--nav)"], ["output", m.output, "var(--text-2)"]]} />}>
        <span>{plural(m.turns, "turn")} · {compact(m.tokens)} tokens</span>
      </Tile>
      <Tile n="06" label="Rate limit" value={lim ? lim.pct : "–"} unit={lim ? "%" : undefined} level={lim ? limitLevel(lim.pct) : undefined}
        tip="The busiest of the 5-hour and weekly rate-limit windows."
        bar={lim ? <Meter pct={lim.pct} label={lim.label} /> : undefined}>
        <span>{lim ? `${lim.label} · resets in ${lim.resets}` : "no rate-limit data"}</span>
      </Tile>
    </div>
  );
}

/** Where the live threads run, which model they use and their approval policy: one quiet row of mono tags. */
export function SurfaceRow({ snapshot }: { snapshot: Snapshot }) {
  const live = snapshot.sessions.filter((x) => x.active);
  if (!live.length) return null;
  const count = (key: (x: Session) => string) => {
    const mp = new Map<string, number>();
    for (const x of live) mp.set(key(x), (mp.get(key(x)) ?? 0) + 1);
    return [...mp.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const groups: [string, [string, number][]][] = [
    ["surface", count((x) => x.running_in)],
    ["model", count((x) => (!x.model || x.model === "-" ? "no model yet" : x.model))],
    ["approval", snapshot.totals.metrics?.approval?.length ? snapshot.totals.metrics.approval : count((x) => x.approval ?? "default")],
  ];
  return (
    <div className={s.chips} aria-label="Surface, model and approval policy of the live threads">
      {groups.map(([name, items]) => (
        <span key={name} className={s.chipGroup}>
          <em>{name}</em>
          {items.map(([k, n]) => <span key={k} className={s.chip}>{k}<b className="tnum">{n}</b></span>)}
        </span>
      ))}
    </div>
  );
}

export function UsageCard({ snapshot }: { snapshot: Snapshot }) {
  const u = snapshot.usage;
  return (
    <Card title="Usage limits" aside={u.cached_ago ? <span className={u.stale ? s.stale : undefined}>cached {u.cached_ago} ago{u.stale ? " · stale" : ""}</span> : null}>
      {u.limits.length === 0 ? (
        <p className={s.empty}>No rate-limit data yet. It is read from the latest token_count event of a Codex session.</p>
      ) : (
        <ul className={s.limits}>
          {u.limits.map((l) => (
            <li key={l.label}>
              <div className={s.limitHead}>
                <span>{l.label}</span>
                {l.binding && <span className={s.binding} title="The limit that applies right now">binding</span>}
                <b className="tnum">{l.pct}%</b>
              </div>
              <Meter pct={l.pct} thick label={l.label} />
              <span className={s.resets}>resets in {l.resets}</span>
            </li>
          ))}
          {u.pools.map((p) => (<li key={p} className={s.pool}><span>credit pool</span><span>{p}</span></li>))}
        </ul>
      )}
      {u.stale && <p className={s.staleNote}>These numbers are old. Send a message in any Codex session to refresh them.</p>}
    </Card>
  );
}

/** A chat whose window is only a guess and is nearly full: the compact window editor, on the likely size (1M), for THIS chat only. */
function OfferBox({ offer }: { offer: WindowOffer }) {
  return (
    <div className={s.offer}>
      <p>This chat is judged against an assumed 200k window. If its real window is bigger, set it here.</p>
      <WindowEditor sid={offer.sid} size={parseSize(offer.size) ?? 1_000_000} canReset={false} variant="compact" />
    </div>
  );
}

const KIND_LABEL: Record<AttentionKind, string> = { waiting: "Waiting for you", context: "Context filling up", memory: "Using a lot of memory", stuck: "May be stuck", idle: "Idle", limit: "Usage limit", disk: "Disk space" };

/** A compact card: the item in focus as a summary (chat, what it needs, where it runs); arrows and dots switch items, a click opens the details. */
export function AttentionCard({ snapshot }: { snapshot: Snapshot }) {
  const items = useMemo(() => attentionItems(snapshot), [snapshot]);
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const at = Math.max(0, items.findIndex((i) => i.key === picked));
  const item = items[at];
  const go = (n: number) => { setPicked(items[(n + items.length) % items.length].key); setOpen(false); };
  const red = items.some((i) => i.level === "RED");
  return (
    <Card title={<><Icon name="alert" size={14} />Attention</>} tone={red ? "bad" : "warn"} id="attention"
      aside={<>
        <span className={cx(s.count, red && s.countRed)} aria-label={`${items.length} need${items.length === 1 ? "s" : ""} attention`}><b className="tnum">{items.length}</b>{items.length === 1 ? "item" : "items"}</span>
        {items.length > 1 && (
          <span className={s.pager}>
            <Button size="small" variant="ghost" aria-label="Previous item" onClick={() => go(at - 1)}>‹</Button>
            <span className={s.dots} role="group" aria-label="Pick an item">
              {items.map((i, n) => <button key={i.key} type="button" className={cx(s.dot, n === at && s.dotOn)} data-level={i.level} aria-label={`Show ${i.title}`} aria-current={n === at} onClick={() => go(n)} />)}
            </span>
            <Button size="small" variant="ghost" aria-label="Next item" onClick={() => go(at + 1)}>›</Button>
          </span>
        )}
      </>}>
      <div className={s.attnItem} data-level={item.level}>
        <button type="button" className={s.attnSummary} aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className={s.attnLine}><Badge level={item.level} /><b className={s.attnTitle}>{item.title}</b><Icon name="chevron" size={14} className={cx(s.chev, open && s.chevOpen)} /></span>
          <span className={s.attnHeadline}>{item.headline}</span>
          <span className={s.attnMeta}>{[KIND_LABEL[item.kind], item.where, item.model].filter(Boolean).join(" · ")}</span>
        </button>
        {open && (
          <div className={s.attnMore}>
            {item.pct !== null && <Meter pct={item.pct} label={item.kind === "limit" ? item.title : "Context used"} />}
            <dl className={s.attnFacts}>
              {item.folder && <div><dt>Folder</dt><dd className={s.mono}>{item.folder}</dd></div>}
              {item.windowText && <div><dt>Window</dt><dd>{item.windowText}</dd></div>}
              {item.resets && <div><dt>Resets in</dt><dd>{item.resets}</dd></div>}
            </dl>
            {item.offer && <OfferBox offer={item.offer} />}
            {item.reasons.length > 1 && <ul className={s.attnReasons}>{item.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            {item.tips.length > 0 && <p className={s.attnDo}><b>What to do:</b> {item.tips.join(" ")}</p>}
            {(item.link || item.resume) && (
              <div className={s.attnActions}>
                {item.link && <a className={s.attnLink} href={item.link.href}>{item.link.label} ↗</a>}
                {item.resume && <CopyButton text={item.resume} what="resume command" label="Copy resume command" />}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
