// Small presentational components. They take props and render; no state of their own except CopyButton's
// two-second "Copied" tick.
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { copyText } from "../../lib/clipboard";
import { tone, type Tone } from "../../lib/format";
import type { Health } from "../../types";
import { Icon, type IconName } from "./Icon";
import { useToast } from "./Toast";
import s from "./ui.module.css";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

export function Badge({ level, large }: { level: Health; large?: boolean }) {
  return <span className={cx(s.badge, s[level.toLowerCase()], large && s.large)}>{level}</span>;
}

/** `levels` = [amber %, red %] of THIS meter's own scale: the fill turns amber / red there and two ticks mark them (default: the fixed 60 / 85). */
export function Meter({ pct, thick, label, levels }: { pct: number; thick?: boolean; label?: string; levels?: [number, number] }) {
  const v = Math.max(0, Math.min(100, pct));
  const t: Tone = levels ? (v >= levels[1] ? "bad" : v >= levels[0] ? "warn" : "good") : tone(v);
  return (
    <span className={cx(s.meter, thick && s.meterThick)} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={label}
      title={levels ? `alerts at ${levels[0]}% (amber) and ${levels[1]}% (red)` : undefined}>
      <span className={cx(s.fill, s[t])} style={{ width: `${v}%` }} />
      {levels && <>
        <i className={cx(s.mark, s.markAmber)} data-testid="mark-amber" style={{ left: `${levels[0]}%` }} />
        <i className={cx(s.mark, s.markRed)} data-testid="mark-red" style={{ left: `${levels[1]}%` }} />
      </>}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={s.kbd}>{children}</kbd>;
}

type Variant = "default" | "ghost" | "primary";

export function Button({ variant = "default", size, icon, children, className, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "small"; icon?: IconName }) {
  const iconOnly = !children;
  return (
    <button type="button" className={cx(s.btn, variant !== "default" && s[variant], size && s[size], iconOnly && s.icon, className)} {...rest}>
      {icon && <Icon name={icon} size={size === "small" ? 13 : 15} />}
      {children}
    </button>
  );
}

/** Copies `text`, shows a toast, and briefly turns into a check mark. */
export function CopyButton({ text, what, label = "Copy" }: { text: string; what: string; label?: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <Button size="small" className={done ? s.copied : undefined} icon={done ? "check" : "copy"} title={`Copy the ${what}`}
      onClick={async (e) => {
        e.stopPropagation();                         // don't also select the card the button sits on
        const ok = await copyText(text);
        toast(ok ? `Copied the ${what}` : "Copy failed: select the text and press ⌘C");
        if (ok) {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        }
      }}>
      {done ? "Copied" : label}
    </Button>
  );
}
