// "Needs attention", compact: the item in focus as a summary (chat, what it needs, where it runs) on a glass card that sits beside
// the usage limits. Arrows and dots switch items; a click opens the details: a gauge, a live trend from the page's own series,
// the folder, what to do, and a link that brings the app forward when the app has a URL scheme.
import { useMemo, useState, type CSSProperties } from "react";
import { attentionItems, type AttentionItem, type AttentionKind } from "../lib/attention";
import { parseSize } from "../lib/settings";
import type { Snapshot } from "../types";
import { Chart } from "./Chart";
import { CopyBtn, Count, Gauge, I, Orb } from "./parts";
import { WindowEditor } from "./WindowControl";
import type { SeriesMap } from "./series";

const KIND: Record<AttentionKind, string> = { waiting: "Waiting for you", context: "Context filling up", memory: "Using a lot of memory", stuck: "May be stuck", idle: "Idle", limit: "Usage limit", disk: "Disk space" };

/** What the card lists: chats and usage limits. Machine alerts (snapshot.system) have their own band and are left out. */
export function cardItems(s: Snapshot): AttentionItem[] {
  const machine = new Set((s.system ?? []).map((a) => a.key));
  return attentionItems(s).filter((i) => !machine.has(i.key));
}

/** The offer for a guessed window: the shared editor (compact), with 1M preselected. */
function Offer({ item }: { item: AttentionItem }) {
  const o = item.offer!;
  return (
    <div className="attn2-offer">
      <p>This chat is judged against an assumed 200k window. If its real window is bigger, set it here.</p>
      <WindowEditor sid={o.sid} variant="compact" initialSize={parseSize(o.size) ?? 1_000_000} currentTokens={200_000} usedTokens={((item.pct ?? 0) / 100) * 200_000} />
    </div>
  );
}

export function Attention({ snapshot, series, index = 4 }: { snapshot: Snapshot; series: SeriesMap; index?: number }) {
  const items = useMemo(() => cardItems(snapshot), [snapshot]);
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const at = Math.max(0, items.findIndex((i) => i.key === picked));
  const item = items[at];
  const go = (n: number) => { setPicked(items[(n + items.length) % items.length].key); setOpen(false); };
  const red = items.some((i) => i.level === "RED");
  const points = item.key.startsWith("limit:") ? series.limit : series[`ctx:${item.key}`];
  return (
    <section className="card attn2 glass rise" data-level={red ? "RED" : "AMBER"} aria-label="Needs attention" style={{ "--i": index } as CSSProperties}>
      <h3>
        <I name="alert" size={14} />Needs attention
        <span className="attn2-count" aria-label={`${items.length} need${items.length === 1 ? "s" : ""} attention`}><b><Count value={items.length} /></b></span>
        {items.length > 1 && (
          <span className="attn2-pager">
            <button type="button" className="btn" data-icon="" aria-label="Previous item" onClick={() => go(at - 1)}><I name="back" size={14} /></button>
            <span className="attn2-dots" role="group" aria-label="Pick an item">
              {items.map((i, n) => <button key={i.key} type="button" className="attn2-dot" data-level={i.level} aria-label={`Show ${i.title}`} aria-current={n === at} onClick={() => go(n)} />)}
            </span>
            <button type="button" className="btn attn2-next" data-icon="" aria-label="Next item" onClick={() => go(at + 1)}><I name="back" size={14} /></button>
          </span>
        )}
      </h3>
      <div key={item.key} className="attn2-item" data-level={item.level}>
        <button type="button" className="attn2-sum" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="attn2-line"><Orb health={item.level} /><b className="attn2-name">{item.title}</b><I name="chevron" size={14} /></span>
          <span className="attn2-headline">{item.headline}</span>
          <span className="attn2-chips">
            <span className="chip" data-tone={item.level === "RED" ? "bad" : "warn"}>{KIND[item.kind]}</span>
            {item.where && <span className="chip" data-tone="accent">{item.where}</span>}
            {item.model && <span className="chip" data-tone="violet">{item.model}</span>}
          </span>
        </button>
        {open && (
          <div className="attn2-more">
            <div className="attn2-viz">
              {item.pct !== null && <Gauge pct={item.pct} size={64} />}
              <div className="attn2-chart">
                <Chart points={points} format={(v) => `${Math.round(v)}%`} label={item.kind === "limit" ? "Busiest limit" : "Context used"} min={0} max={100} marks={item.kind === "limit" ? [85] : snapshot.sessions.filter((x) => x.sid === item.key).map((x) => x.ctx_amber_pct)}
                  color={item.level === "RED" ? "var(--bad)" : "var(--warn)"} caption />
              </div>
            </div>
            {item.windowText && <div className="attn2-fact"><span>window</span>{item.windowText}</div>}
            {item.folder && <div className="attn2-fact"><span>folder</span><code>{item.folder}</code></div>}
            {item.resets && <div className="attn2-fact"><span>resets in</span>{item.resets}</div>}
            {item.reasons.length > 1 && <ul className="attn2-reasons">{item.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            {item.tips.length > 0 && <p className="attn2-do"><b>What to do</b>{item.tips.join(" ")}</p>}
            {item.offer && <Offer item={item} />}
            {(item.link || item.resume) && (
              <div className="attn2-actions">
                {item.link && <a className="btn" data-primary="" href={item.link.href}>{item.link.label}<I name="plug" size={14} /></a>}
                {item.resume && <CopyBtn text={item.resume} what="resume command" label="Copy resume command" />}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
