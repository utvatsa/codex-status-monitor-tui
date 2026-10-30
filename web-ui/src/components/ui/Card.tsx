import type { ReactNode } from "react";
import { cx } from "./primitives";
import s from "./Card.module.css";

/** A titled surface. `tone` tints the header (warn for Attention, muted for Archived). */
export function Card({ title, aside, tone, children, className, id, flush }:
  { title: ReactNode; aside?: ReactNode; tone?: "warn" | "bad" | "muted"; children: ReactNode; className?: string; id?: string; flush?: boolean }) {
  return (
    <section className={cx(s.card, tone && s[tone], className)} aria-labelledby={id ? `${id}-title` : undefined}>
      <header className={s.head}>
        <h2 id={id ? `${id}-title` : undefined}>{title}</h2>
        {aside && <div className={s.aside}>{aside}</div>}
      </header>
      <div className={flush ? undefined : s.body}>{children}</div>
    </section>
  );
}
