// Changing the context window of ONE chat: a dropdown for the maximum, two linked threshold rows (percent and tokens), a plain summary
// with a zone bar, and the equivalent command. One editor, two shapes: "full" in the details panel, "compact" in the Attention card's
// offer. It never changes a model-wide or tool-wide setting; the command is always shown, so a failed write is not a dead end.
import { useState } from "react";
import { SOURCE_TEXT } from "../lib/attention";
import { chatCommand, clearChat, parseSize, setChat, suggestLevels } from "../lib/settings";
import type { Session } from "../types";
import { Button, CopyButton, cx } from "./ui/primitives";
import { useToast } from "./ui/Toast";
import s from "./WindowControl.module.css";

const OPTIONS: { value: string; label: string }[] = [
  { value: "200k", label: "200k" }, { value: "300k", label: "300k" }, { value: "400k", label: "400k" }, { value: "500k", label: "500k" },
  { value: "600k", label: "600k" }, { value: "800k", label: "800k" }, { value: "1m", label: "1M (recommended)" }, { value: "1.5m", label: "1.5M" },
  { value: "2m", label: "2M" }, { value: "custom", label: "Custom…" },
];

/** 600000 -> "600k", 1000000 -> "1m", 408500 -> "408.5k": the shape the command and the inputs use. */
function sizeText(n: number): string {
  return n >= 1e6 && n % 1e5 === 0 ? `${n / 1e6}m` : `${Math.round(n / 100) / 10}k`;
}
const show = (n: number) => sizeText(n).toUpperCase().replace(/K$/, "k");           // "1M", "408k"

/** A token count typed by hand: "408k", "1.2m" or a plain number. (Smaller than a window, so no 10k floor like parseSize.) */
function parseTok(v: string): number | null {
  const t = v.trim().toLowerCase();
  const n = t.endsWith("m") ? parseFloat(t) * 1e6 : t.endsWith("k") ? parseFloat(t) * 1e3 : Number(t);
  return t !== "" && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

type Row = { pct: string; tok: string };
const tokOf = (max: number | null, pct: string): string => {
  const p = Number(pct);
  return max !== null && pct.trim() !== "" && Number.isFinite(p) ? sizeText(Math.round(max * p / 100)) : "";
};
const rowFor = (max: number | null, pct: number): Row => ({ pct: String(pct), tok: tokOf(max, String(pct)) });

interface EditorProps {
  sid: string;
  size: number;                         // the maximum to start on (the chat's window, or 1M when it is offered)
  levels?: [number, number];            // the chat's own levels, when the user chose them
  canReset: boolean;                    // the window was set on this chat: it can go back to automatic
  variant: "full" | "compact";
  onClose?: () => void;
}

export function WindowEditor({ sid, size, levels, canReset, variant, onClose }: EditorProps) {
  const toast = useToast();
  const listed = OPTIONS.some((o) => o.value !== "custom" && parseSize(o.value) === size);
  const [pick, setPick] = useState(listed ? OPTIONS.find((o) => parseSize(o.value) === size)!.value : "custom");
  const [custom, setCustom] = useState(sizeText(size));
  const max = parseSize(pick === "custom" ? custom : pick);
  const start = levels ?? suggestLevels(size);
  const [amber, setAmber] = useState<Row>(rowFor(size, start[0]));
  const [red, setRed] = useState<Row>(rowFor(size, start[1]));
  const [edited, setEdited] = useState({ amber: !!levels, red: !!levels });       // a row typed by hand keeps its percentage when the maximum changes
  const [more, setMore] = useState(variant === "full");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const suggested = max !== null ? suggestLevels(max) : null;

  const changeMax = (nextPick: string, nextCustom: string) => {
    setPick(nextPick);
    setCustom(nextCustom);
    const m = parseSize(nextPick === "custom" ? nextCustom : nextPick);
    if (m === null) return;
    const [sa, sr] = suggestLevels(m);
    setAmber((r) => rowFor(m, edited.amber ? Number(r.pct) || 0 : sa));
    setRed((r) => rowFor(m, edited.red ? Number(r.pct) || 0 : sr));
  };

  const edit = (which: "amber" | "red", field: "pct" | "tok", v: string) => {
    const set = which === "amber" ? setAmber : setRed;
    setEdited((e) => ({ ...e, [which]: true }));
    if (field === "pct") return set({ pct: v, tok: tokOf(max, v) });
    const t = parseTok(v);
    set({ tok: v, pct: t !== null && max ? String(Math.min(100, Math.max(1, Math.round(t / max * 100)))) : "" });
  };

  const a = Number(amber.pct), r = Number(red.pct);
  const whole = (v: string) => v.trim() !== "" && Number.isInteger(Number(v));
  const problem: string | null =
    max === null ? "The maximum must be between 10k and 10M, like 600k, 1m or 1.5m."
    : !whole(amber.pct) || !whole(red.pct) ? "Amber and red must be whole percentages."
    : !(a >= 1 && a < r && r <= 100) ? "Amber must be at least 1% and lower than red, and red at most 100%."
    : [amber.tok, red.tok].some((t) => { const n = parseTok(t); return n === null || n > max; }) ? `Thresholds must be a token count up to the maximum (${show(max)}).`
    : null;
  const sizeArg = (pick === "custom" ? custom : pick).trim().toLowerCase();
  const command = problem ? null : chatCommand(sid, sizeArg, a, r);
  const tokA = max !== null ? Math.round(max * a / 100) : 0, tokR = max !== null ? Math.round(max * r / 100) : 0;

  const run = async (job: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true);
    setFailed(null);
    const res = await job();
    setBusy(false);
    if (res.ok) {
      toast(done);
      onClose?.();
    } else setFailed(res.error ?? "the change was not saved");
  };

  const rows = (
    <div className={s.thresholds}>
      {([["amber", "Amber", amber], ["red", "Red", red]] as const).map(([key, label, row]) => (
        <div key={key} className={s.thRow} data-zone={key}>
          <span className={s.thLabel}>{label}</span>
          <input type="number" min={1} max={100} aria-label={`${label} percent`} value={row.pct} onChange={(e) => edit(key, "pct", e.target.value)} />
          <span className={s.eq}>% =</span>
          <input aria-label={`${label} tokens`} value={row.tok} spellCheck={false} onChange={(e) => edit(key, "tok", e.target.value)} />
        </div>
      ))}
      {suggested && (
        <button type="button" className={s.link} onClick={() => { setEdited({ amber: false, red: false }); setAmber(rowFor(max, suggested[0])); setRed(rowFor(max, suggested[1])); }}>
          Use suggested ({suggested[0]}% / {suggested[1]}%)
        </button>
      )}
    </div>
  );

  return (
    <div className={cx(s.editor, variant === "compact" && s.compact)} role="group" aria-label="Change the context window" onClick={(e) => e.stopPropagation()}>
      <p className={s.scope}>Applies to <b>this chat only</b>. Other chats and the model's default are not changed.</p>
      <div className={s.maxRow}>
        <label>Maximum context
          <select value={pick} onChange={(e) => changeMax(e.target.value, custom)}>
            {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {pick === "custom" && (
          <label>Custom size<input value={custom} onChange={(e) => changeMax("custom", e.target.value)} placeholder="e.g. 750k" spellCheck={false} /></label>
        )}
      </div>
      {variant === "compact" && (
        <button type="button" className={s.link} aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Hide thresholds" : "Edit thresholds"}</button>
      )}
      {more && rows}
      {problem ? <p className={s.error} role="alert">{problem}</p> : (
        <>
          <p className={s.summary}>Alerts at <b className="tnum">{show(tokA)}</b> (amber) and <b className="tnum">{show(tokR)}</b> (red) of <b className="tnum">{show(max!)}</b>.</p>
          <span className={s.zones} role="img" aria-label={`ok up to ${a}%, amber ${a}% to ${r}%, red from ${r}%`}>
            <i className={s.zOk} style={{ width: `${a}%` }} /><i className={s.zAmber} style={{ width: `${r - a}%` }} /><i className={s.zRed} style={{ width: `${100 - r}%` }} />
          </span>
        </>
      )}
      {failed && <p className={s.error} role="alert">Not saved: {failed}. Run the command below instead.</p>}
      <div className={s.actions}>
        <Button variant="primary" size="small" disabled={!!problem || busy}
          onClick={() => run(() => setChat(sid, sizeArg, a, r), `Window set to ${show(max!)} for this chat`)}>Apply to this chat</Button>
        {variant === "full" && <Button size="small" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>}
        {canReset && <Button size="small" disabled={busy} onClick={() => run(() => clearChat(sid), "Back to automatic for this chat")}>Reset to automatic</Button>}
      </div>
      <div className={s.cmd}>
        <span className={s.k}>or run</span>
        <div className={s.cmdBox}>
          <code>{command ?? "fix the values above to see the command"}</code>
          {command && <CopyButton text={command} what="set-window command" label="Copy command" />}
        </div>
      </div>
    </div>
  );
}

export function WindowControl({ x }: { x: Session }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={s.wrap}>
      <div className={s.row}>
        <span className={s.k}>window</span>
        <span className={s.summaryLine}>
          <b className="tnum">{x.window}</b> · {SOURCE_TEXT[x.window_source]}
          <span className={s.dim}> · alerts at <span className="tnum">{x.ctx_amber}</span> / <span className="tnum">{x.ctx_red}</span> ({x.ctx_amber_pct}% / {x.ctx_red_pct}%)</span>
        </span>
        {!open && <Button size="small" onClick={(e) => { e.stopPropagation(); setOpen(true); }} aria-label="Change the context window">Change</Button>}
      </div>
      {open && (
        <WindowEditor sid={x.sid} size={x.window_tokens} levels={x.levels_custom ? [x.ctx_amber_pct, x.ctx_red_pct] : undefined}
          canReset={x.window_source === "chat"} variant="full" onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
