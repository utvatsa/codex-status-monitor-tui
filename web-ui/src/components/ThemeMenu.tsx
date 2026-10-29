// A small accessible popup menu: a button with aria-haspopup, a listbox of options, arrow keys / Enter / Escape,
// and a click outside closes it. Keys pressed inside stop here, so the page's own shortcuts don't also fire.
import { useEffect, useRef, useState } from "react";
import { THEMES, type ThemeId } from "../hooks/useTheme";
import { Icon } from "./ui/Icon";
import { cx } from "./ui/primitives";
import s from "./ThemeMenu.module.css";

export function ThemeMenu({ theme, onChange }: { theme: ThemeId; onChange: (t: ThemeId) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, THEMES.findIndex((t) => t.id === theme)));
    list.current?.focus();
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open, theme]);

  const choose = (i: number) => {
    onChange(THEMES[i].id);
    setOpen(false);
  };

  return (
    <div className={s.root} ref={root}>
      <button type="button" className={s.trigger} aria-haspopup="listbox" aria-expanded={open} aria-label={`Switch theme, now ${current.label}`}
        title="Switch theme (d cycles)" onClick={() => setOpen((o) => !o)}>
        <span className={s.triggerHint}>Theme</span>
        <Swatch colors={current.swatch} />
        <span className={s.triggerLabel}>{current.label}</span>
        <Icon name="chevron" size={13} />
      </button>
      {open && (
        <ul ref={list} className={s.menu} role="listbox" tabIndex={-1} aria-label="Switch theme" aria-activedescendant={`theme-${THEMES[active].id}`}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "ArrowDown") { setActive((a) => (a + 1) % THEMES.length); e.preventDefault(); }
            else if (e.key === "ArrowUp") { setActive((a) => (a - 1 + THEMES.length) % THEMES.length); e.preventDefault(); }
            else if (e.key === "Enter" || e.key === " ") { choose(active); e.preventDefault(); }
            else if (e.key === "Escape" || e.key === "Tab") setOpen(false);
          }}>
          <li role="presentation" className={s.menuTitle}>Switch theme</li>
          {THEMES.map((t, i) => (
            <li key={t.id} id={`theme-${t.id}`} role="option" aria-selected={t.id === theme}
              className={cx(s.option, i === active && s.active)} onMouseEnter={() => setActive(i)} onClick={() => choose(i)}>
              <Swatch colors={t.swatch} />
              <span className={s.text}><b>{t.label}</b><small>{t.hint}</small></span>
              {t.id === theme && <Icon name="check" size={14} className={s.check} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Swatch({ colors }: { colors: readonly string[] }) {
  return (
    <span className={s.swatch} aria-hidden="true">
      {colors.map((c) => <i key={c} style={{ background: c }} />)}
    </span>
  );
}
