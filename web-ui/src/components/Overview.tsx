// The top of the page: who you are, four headline numbers, usage limits and anything that needs attention.
import { useMemo, useState, type ReactNode } from "react";
import type { Snapshot, WindowOffer } from "../types";
import { attentionItems, type AttentionKind } from "../lib/attention";
import { agentCards, agentTotals } from "../lib/agents";
import { compact, plural } from "../lib/format";
import { parseSize } from "../lib/settings";
import { Card } from "./ui/Card";
import { Icon, type IconName } from "./ui/Icon";
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

function Tile({ icon, label, value, children, tone, onOpen, openLabel }: { icon: IconName; label: string; value: ReactNode; children?: ReactNode; tone?: "warn" | "bad"; onOpen?: () => void; openLabel?: string }) {
  return (
    <div className={cx(s.tile, tone && s[tone], onOpen && s.tileBtn)}
      {...(onOpen ? { role: "button", tabIndex: 0, "aria-label": openLabel, onClick: onOpen,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } } } : {})}>
      <div className={s.tileHead}><Icon name={icon} size={15} /><span>{label}</span></div>
      <div className={cx(s.kpi, "tnum")}>{value}</div>
      {children && <div className={s.tileFoot}>{children}</div>}
    </div>
  );
}

export function KpiTiles({ snapshot, showArc, onOpenAgents }: { snapshot: Snapshot; showArc: boolean; onOpenAgents?: () => void }) {
  const t = snapshot.totals;
  const busiest = [...snapshot.usage.limits].sort((a, b) => b.pct - a.pct)[0];
  const attention = t.health.AMBER + t.health.RED;
  const agents = agentTotals(snapshot.sessions);
  const mains = agentCards(snapshot.sessions);
  return (
    <div className={s.tiles}>
      <Tile icon="chat" label="Live chats" value={t.live} tone={t.health.RED ? "bad" : attention ? "warn" : undefined}>
        <span className={s.healthRow}>
          <Badge level="OK" /> <b className="tnum">{t.health.OK}</b>
          <Badge level="AMBER" /> <b className="tnum">{t.health.AMBER}</b>
          <Badge level="RED" /> <b className="tnum">{t.health.RED}</b>
        </span>
      </Tile>
      <Tile icon="plug" label="Agents" value={<>{agents.main + agents.running}<small>running</small></>} onOpen={onOpenAgents} openLabel="Open the Agents view">
        <span title="Every live chat is one main agent; subagents are extra agents a chat started (Task, Plan, Explore ...). Running now = main agents + running subagents.">
          {agents.main} main · {plural(agents.running, "subagent")} running
        </span>
        {mains.length > 0 && (
          <ul className={s.agentList}>
            {mains.slice(0, 3).map((c) => (
              <li key={c.session.sid} data-state={c.rows.main.state} title={`${c.rows.main.name}: ${c.rows.main.state}`}>
                <i /><span>{c.rows.main.name}</span>
                {c.rows.running > 0 && <em>+{c.rows.running} running</em>}
              </li>
            ))}
            {mains.length > 3 && <li className={s.agentMore}>+{mains.length - 3} more chats</li>}
          </ul>
        )}
      </Tile>
      <Tile icon="cpu" label="Memory held" value={<>{t.mem_mb.toLocaleString()}<small>MB</small></>}>
        <span>by {plural(t.live, "live process", "live processes")}</span>
      </Tile>
      <Tile icon="coin" label="Live tokens" value={compact(t.live_tokens)}>
        <span>{showArc ? `+ ${compact(t.arc_tokens)} across ${plural(t.archived, "archived chat")}` : "input + cached + output, live chats (Codex has no price table)"}</span>
      </Tile>
      <Tile icon="gauge" label="Busiest limit" value={busiest ? <>{busiest.pct}<small>%</small></> : "–"}
        tone={busiest && busiest.pct >= 85 ? "bad" : busiest && busiest.pct >= 60 ? "warn" : undefined}>
        {busiest ? <><Meter pct={busiest.pct} label={busiest.label} /><span>{busiest.label} · resets in {busiest.resets}</span></> : <span>no rate-limit data</span>}
      </Tile>
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
