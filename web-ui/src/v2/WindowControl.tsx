// The context window of ONE chat, in the drawer: the size and where it came from, the alert levels on a zone bar, and an inline editor
// to change both. It only ever writes that chat's setting (setChat / clearChat); the equivalent command is always shown as a fallback.
import { useState, type CSSProperties } from "react";
import { SOURCE_TEXT } from "../lib/attention";
import { chatCommand, clearChat, parseSize, setChat, suggestLevels } from "../lib/settings";
import type { Session } from "../types";
import { CopyBtn, I, useToast } from "./parts";

/** The window as a bar: used part filled, the amber zone and the red zone shaded. */
export function ZoneBar({ pct, amber, red }: { pct: number; amber: number; red: number }) {
  return (
    <div className="zone" role="img" aria-label={`Window: ${pct}% used; amber from ${amber}%, red from ${red}%`}>
      <u className="z-amber" style={{ left: `${amber}%`, width: `${Math.max(0, red - amber)}%` }} />
      <u className="z-red" style={{ left: `${red}%`, width: `${Math.max(0, 100 - red)}%` }} />
      <i style={{ "--p": Math.min(100, pct) } as CSSProperties} />
      <span className="z-t" style={{ left: `${amber}%` }}>{amber}%</span>
      <span className="z-t" style={{ left: `${red}%` }}>{red}%</span>
    </div>
  );
}

const SIZES = [200_000, 300_000, 400_000, 500_000, 600_000, 800_000, 1_000_000, 1_500_000, 2_000_000];
const REC = 1_000_000;

/** 1_000_000 -> "1M", 600_000 -> "600k" (for people) */
export const sizeLabel = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(2)}M` : `${Math.round(n / 1000)}k`);
/** the same size as the command and the server want it: "1m", "600k" */
const sizeText = (n: number) => sizeLabel(n).toLowerCase();

/** Tokens typed in a threshold box: "408k", "1.2m" or a plain number. Unlike a window, small values are fine. */
function parseTok(v: string): number | null {
  const t = v.trim().toLowerCase();
  const n = t.endsWith("m") ? parseFloat(t) * 1e6 : t.endsWith("k") ? parseFloat(t) * 1e3 : Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
const toTok = (pct: number, max: number) => sizeLabel(Math.round((pct * max) / 100)).toLowerCase();
const clamp = (n: number) => Math.max(1, Math.min(100, n));

interface EditorProps {
  sid: string;
  variant: "compact" | "full";
  usedTokens: number;                       // what the chat uses now, for the zone bar
  currentTokens: number;                    // the window it is judged against now
  levels?: [number, number] | null;         // the user's own levels for this chat, when there are any
  initialSize?: number;                     // preselect this size (the offer preselects 1M)
  canReset?: boolean;
  onClose?: () => void;
}

/** One editor for a chat's window: a size list, two linked threshold rows, a plain summary, a live zone bar and the equivalent command. */
export function WindowEditor({ sid, variant, usedTokens, currentTokens, levels = null, initialSize, canReset = false, onClose }: EditorProps) {
  const toast = useToast();
  const first = initialSize ?? currentTokens;
  const listed = SIZES.includes(first);
  const [sel, setSel] = useState<string>(listed ? String(first) : "custom");
  const [custom, setCustom] = useState(listed ? "" : sizeText(first));
  const max = sel === "custom" ? parseSize(custom) : Number(sel);
  const base = max ?? first;
  const seed = levels && initialSize === undefined ? levels : suggestLevels(base);
  const [pct, setPct] = useState<[string, string]>([String(seed[0]), String(seed[1])]);
  const [tok, setTok] = useState<[string, string]>([toTok(seed[0], base), toTok(seed[1], base)]);
  const [edited, setEdited] = useState<[boolean, boolean]>(levels && initialSize === undefined ? [true, true] : [false, false]);
  const [more, setMore] = useState(variant === "full");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sug = suggestLevels(base);
  const a = Number(pct[0]), r = Number(pct[1]);
  const pctOk = Number.isInteger(a) && Number.isInteger(r) && a >= 1 && a < r && r <= 100;
  const tokVals = [parseTok(tok[0]), parseTok(tok[1])];
  const problem = max === null ? "Enter a size from 10k to 10M, like 600k or 1m."
    : !pctOk ? "Amber must be 1 or more and below red, and red at most 100."
    : tokVals.some((t) => t === null) ? "Enter tokens like 408k or 408000."
    : tokVals.some((t) => (t as number) > max) ? `Thresholds can't be above the maximum (${sizeLabel(max)}).`
    : null;
  const valid = problem === null;

  const setMax = (m: number | null) => {
    if (m === null) return;
    const s = suggestLevels(m);
    const np: [string, string] = [edited[0] ? pct[0] : String(s[0]), edited[1] ? pct[1] : String(s[1])];
    setPct(np);
    setTok([0, 1].map((i) => (Number.isFinite(Number(np[i])) ? toTok(Number(np[i]), m) : tok[i])) as [string, string]);
  };
  const pickSel = (v: string) => { setSel(v); if (v !== "custom") setMax(Number(v)); };
  const typeCustom = (v: string) => { setCustom(v); setMax(parseSize(v)); };
  const editPct = (i: 0 | 1, v: string) => {
    setEdited(i ? [edited[0], true] : [true, edited[1]]);
    setPct(i ? [pct[0], v] : [v, pct[1]]);
    const n = Number(v);
    if (max !== null && Number.isFinite(n) && v.trim() !== "") setTok(i ? [tok[0], toTok(n, max)] : [toTok(n, max), tok[1]]);
  };
  const editTok = (i: 0 | 1, v: string) => {
    setEdited(i ? [edited[0], true] : [true, edited[1]]);
    setTok(i ? [tok[0], v] : [v, tok[1]]);
    const t = parseTok(v);
    if (max !== null && t !== null) setPct((p) => (i ? [p[0], String(clamp(Math.round((t / max) * 100)))] : [String(clamp(Math.round((t / max) * 100))), p[1]]));
  };
  const useSuggested = () => {
    if (max === null) return;
    setEdited([false, false]); setPct([String(sug[0]), String(sug[1])]); setTok([toTok(sug[0], max), toTok(sug[1], max)]);
  };

  const run = async (go: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true); setError(null);
    const res = await go();
    setBusy(false);
    if (res.ok) { toast(done); onClose?.(); } else setError(res.error ?? "the change was not saved");
  };
  const apply = () => { if (valid && max !== null) run(() => setChat(sid, sizeText(max), a, r), "Window set for this chat"); };
  const cmd = chatCommand(sid, sizeText(max ?? first), pctOk ? a : undefined, pctOk ? r : undefined);
  const shown = max !== null && pctOk;
  const at = (p: number) => sizeLabel(Math.round((p * (max ?? 0)) / 100));
  const differs = max !== null && (pct[0] !== String(sug[0]) || pct[1] !== String(sug[1]));

  const rowOf = (i: 0 | 1, name: "Amber" | "Red") => (
    <div className="wthr" data-k={name.toLowerCase()}>
      <span className="wthr-n">{name}</span>
      <label><input value={pct[i]} onChange={(e) => editPct(i, e.target.value)} inputMode="numeric" aria-label={`${name} percent`} /><em>%</em></label>
      <span className="wthr-eq">=</span>
      <label><input value={tok[i]} onChange={(e) => editTok(i, e.target.value)} aria-label={`${name} tokens`} /><em>tokens</em></label>
    </div>
  );

  return (
    <div className="wedit" data-variant={variant} role="group" aria-label="Change the context window">
      <label className="wedit-max">Maximum context
        <select value={sel} onChange={(e) => pickSel(e.target.value)} aria-label="Maximum context">
          {SIZES.map((n) => <option key={n} value={n}>{n === REC ? `${sizeLabel(n)} (recommended)` : sizeLabel(n)}</option>)}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {sel === "custom" && <label className="wedit-custom">Custom size<input value={custom} onChange={(e) => typeCustom(e.target.value)} aria-label="Custom size" aria-invalid={max === null} placeholder="e.g. 750k or 1.2m" /></label>}
      <p className="wedit-sum" aria-live="polite">{shown ? `Alerts at ${at(a)} (amber) and ${at(r)} (red) of ${sizeLabel(max!)}.` : "Fill in a valid size and levels to see the alerts."}</p>
      <ZoneBar pct={max ? Math.min(100, Math.round((usedTokens / max) * 100)) : 0} amber={pctOk ? a : 85} red={pctOk ? r : 95} />
      {variant === "compact" && <button type="button" className="wedit-more" aria-expanded={more} onClick={() => setMore(!more)}><I name="chevron" size={13} />Edit thresholds</button>}
      {more && (
        <div className="wthr-box">
          {rowOf(0, "Amber")}{rowOf(1, "Red")}
          {differs && <button type="button" className="wedit-sug" onClick={useSuggested}>Use suggested ({sug[0]}% / {sug[1]}%)</button>}
        </div>
      )}
      {problem && <p className="wedit-err" role="alert">{problem}</p>}
      {error && <p className="wedit-err" role="alert">Not saved: {error}. Run the command below instead.</p>}
      <p className="note" style={{ margin: 0 }}>Applies to this chat only. Other chats and the tool's settings stay as they are.</p>
      <div className="wedit-actions">
        <button type="button" className="btn" data-primary="" disabled={!valid || busy} onClick={apply}>Apply to this chat</button>
        {variant === "full" && <button type="button" className="btn" onClick={onClose}>Cancel</button>}
        {canReset && <button type="button" className="btn" disabled={busy} onClick={() => run(() => clearChat(sid), "Back to automatic for this chat")}>Reset to automatic</button>}
        {variant === "compact" && <CopyBtn text={cmd} what="window command" label="Copy command" />}
      </div>
      {variant === "full" && <div className="cmd"><code>{cmd}</code><CopyBtn text={cmd} what="window command" /></div>}
      {variant === "compact" && <div className="cmd"><code>{cmd}</code></div>}
    </div>
  );
}

export function WindowControl({ x }: { x: Session }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="win" aria-label="Window setting">
      <div className="win-top">
        <div>
          <b className="tnum">{x.window} window</b>
          <span className="win-src"> · {SOURCE_TEXT[x.window_source]}</span>
          <div className="win-lv">alerts at <b className="tnum">{x.ctx_amber}</b> / <b className="tnum">{x.ctx_red}</b>{x.levels_custom ? " (your levels)" : ""} · applies to this chat only</div>
        </div>
        {!editing && <button type="button" className="btn" onClick={() => setEditing(true)}><I name="gauge" size={14} />Change</button>}
      </div>
      {!editing && <ZoneBar pct={x.ctx_pct} amber={x.ctx_amber_pct} red={x.ctx_red_pct} />}
      {editing && <WindowEditor sid={x.sid} variant="full" usedTokens={(x.ctx_pct / 100) * x.window_tokens} currentTokens={x.window_tokens}
        levels={x.levels_custom ? [x.ctx_amber_pct, x.ctx_red_pct] : null} canReset={x.window_source === "chat"} onClose={() => setEditing(false)} />}
      {!editing && x.window_source === "chat" && (
        <div className="cmd"><code>{x.clear_command}</code><CopyBtn text={x.clear_command} what="reset command" /></div>
      )}
    </div>
  );
}
