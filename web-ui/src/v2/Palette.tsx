// Two overlays: the command palette (⌘K / Ctrl+K) and the keyboard-shortcuts sheet. Both are plain divs with
// role="dialog": Escape and a click on the backdrop close them, and the palette's input is focused on open.
import { useEffect, useMemo, useRef, useState } from "react";
import { SHORTCUTS } from "../components/ShortcutsDialog";
import { I, Kbd } from "./parts";

export interface Command { id: string; group: string; title: string; hint?: string[]; run: () => void }

export function Palette({ open, commands, onClose }: { open: boolean; commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  // Every word typed must appear in the title or group (order does not matter).
  const found = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => words.every((w) => `${c.group} ${c.title}`.toLowerCase().includes(w)));
  }, [commands, q]);
  useEffect(() => setSel(0), [q]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" }); }, [sel, found]);

  if (!open) return null;
  const go = (c?: Command) => { if (!c) return; onClose(); c.run(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(found.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); go(found[sel]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };
  let last = "";
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pal glass glass-strong" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey}>
        <div className="pal-in">
          <I name="search" size={18} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to a chat, change the view, switch theme…" aria-label="Search commands" />
          <Kbd>esc</Kbd>
        </div>
        <div className="pal-list" ref={list} role="listbox">
          {found.length === 0 && <p className="empty">Nothing matches “{q}”.</p>}
          {found.map((c, i) => {
            const head = c.group !== last ? <div className="pal-g" key={`g-${c.group}`}>{c.group}</div> : null;
            last = c.group;
            return (
              <div key={c.id}>
                {head}
                <button className="pal-i" role="option" aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={() => go(c)}>
                  {c.title}{c.hint && <small>{c.hint.map((h) => <Kbd key={h}>{h}</Kbd>)}</small>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="pal-foot"><span><Kbd>↑</Kbd> <Kbd>↓</Kbd> move</span><span><Kbd>⏎</Kbd> run</span><span><Kbd>esc</Kbd> close</span></div>
      </div>
    </div>
  );
}

export function Help({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "?") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="help glass glass-strong" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <h2>Keyboard shortcuts</h2>
        <div className="help-cols">
          {[["Command palette", [["⌘K  Ctrl+K", "search every action and chat"]]] as [string, [string, string][]], ["Appearance", [["m", "flip light / dark"], ["d", "next colour palette"]]] as [string, [string, string][]], ...SHORTCUTS].map(([title, rows]) => (
            <section key={title}>
              <h4>{title}</h4>
              <dl>{rows.map(([k, d]) => (<div key={k} style={{ display: "contents" }}><dt>{k.split(/\s{2,}/).map((p) => <Kbd key={p}>{p}</Kbd>)}</dt><dd>{d}</dd></div>))}</dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
