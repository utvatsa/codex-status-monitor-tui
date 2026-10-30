// Small shared pieces of the second design: icons with its own class, keys, orbs, animated numbers, sparkline, ring,
// gauge, copy button and the toast provider.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../components/ui/Icon";
import { copyText } from "../lib/clipboard";
import { tone } from "../lib/format";
import type { Health } from "../types";
import { useCountUp } from "./hooks";

export function I({ name, size = 16 }: { name: IconName; size?: number }) {
  return <Icon name={name} size={size} className="icon" />;
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>;

export const Orb = ({ health, live = true }: { health: Health; live?: boolean }) => <span className="orb" data-h={health} data-live={live} aria-hidden="true" />;

/** A number that counts up to its value. `digits` decimals, `prefix` like "$". */
export function Count({ value, digits = 0, prefix = "" }: { value: number; digits?: number; prefix?: string }) {
  const v = useCountUp(value);
  return <span className="tnum">{prefix}{v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}</span>;
}

const toneVar = (pct: number) => ({ good: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)" })[tone(pct)];

/** A slim horizontal meter (replaces the big charts): the fill grows when it first appears and takes the health colour. */
export function Meter({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ "--p": Math.min(100, pct), background: toneVar(pct) } as React.CSSProperties} />
    </div>
  );
}

/** Small radial gauge: the arc grows to `pct` when it first appears and takes the health colour. */
export function Gauge({ pct, size = 56 }: { pct: number; size?: number }) {
  const R = 33, C = 2 * Math.PI * R;
  const [shown, setShown] = useState(0);
  useEffect(() => { const t = requestAnimationFrame(() => setShown(pct)); return () => cancelAnimationFrame(t); }, [pct]);
  const id = useId();
  return (
    <div className="gauge-svg" style={{ width: size, height: size }} role="meter" aria-label="usage" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={toneVar(pct)} /><stop offset="1" stopColor="var(--accent-2)" /></linearGradient></defs>
        <circle className="track" cx="40" cy="40" r={R} />
        <circle className="fill" cx="40" cy="40" r={R} stroke={`url(#${id})`} strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(100, shown) / 100)} />
      </svg>
      <b className="tnum" style={{ fontSize: Math.round(size * 0.27) }}>{pct}<small>%</small></b>
    </div>
  );
}

// ---- toasts ----------------------------------------------------------------------------------------------------------
const ToastCtx = createContext<(text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; text: string }[]>([]);
  const n = useRef(0);
  const show = useCallback((text: string) => {
    const id = ++n.current;
    setItems((l) => [...l.slice(-2), { id, text }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className="toast glass glass-strong"><I name="check" size={15} />{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/** Copy button: the icon pops into a check for a moment and a toast confirms. */
export function CopyBtn({ text, what, label }: { text: string; what: string; label?: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const go = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyText(text);
    toast(ok ? `Copied the ${what}` : "Copy failed: select the text and press ⌘C");
    if (ok) { setDone(true); clearTimeout(timer.current); timer.current = setTimeout(() => setDone(false), 1400); }
  };
  return (
    <button type="button" className="btn copy" data-icon={label ? undefined : ""} data-done={done || undefined} onClick={go} aria-label={`Copy ${what}`} title={`Copy ${what}`}>
      <I name={done ? "check" : "copy"} size={15} />{label}
    </button>
  );
}

/** A short code (session or agent) in a monospace chip; clicking copies the full id. */
export function CodeChip({ code, full, what }: { code: string; full: string; what: string }) {
  const toast = useToast();
  return (
    <button type="button" className="chip code" title={`${what}: ${full}  ·  click to copy`} aria-label={`Copy ${what} ${code}`}
      onClick={async (e) => { e.stopPropagation(); toast((await copyText(full)) ? `Copied the ${what}` : "Copy failed"); }}>
      <span className="code-h">#</span>{code}
    </button>
  );
}
