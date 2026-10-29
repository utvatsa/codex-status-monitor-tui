// The native <dialog> element with showModal() gives a real modal for free: focus is trapped inside,
// Escape closes it, and the page behind is inert. React only mirrors the `open` prop into it.
import { useEffect, useRef } from "react";
import { Button, Kbd } from "./ui/primitives";
import s from "./ShortcutsDialog.module.css";

export const SHORTCUTS: [string, [string, string][]][] = [
  ["Move and select", [
    ["↑ ↓  j k", "move the highlight"],
    ["g  G", "first / last chat"],
    ["⏎", "select the highlighted chat; again: copy its resume command"],
    ["Esc  b", "back to the list (or clear the filter)"],
  ]],
  ["Copy (selected chat)", [
    ["y", "resume command"],
    ["i", "session id"],
    ["f", "fresh-chat command"],
  ]],
  ["View", [
    ["+  −", "more / less detail"],
    ["1 – 5", "minimal, compact, lean, standard, full"],
    ["a", "archived chats"],
    ["c", "compact rows"],
    ["p", "prompts"],
    ["v  s", "subagents: latest 3 / all"],
    ["t", "archived prompt line"],
    ["e", "expand / collapse every row"],
    ["u", "account details"],
    ["A  g", "Agents view / back to Chats (g: while in the Agents view)"],
  ]],
  ["Page", [
    ["r", "read again now"],
    ["/", "filter chats"],
    ["d", "next theme"],
    ["?", "this list"],
  ]],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className={s.dialog} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}
      aria-labelledby="shortcuts-title">
      <header className={s.head}>
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <Button variant="ghost" size="small" icon="close" onClick={onClose} aria-label="Close" />
      </header>
      <div className={s.groups}>
        {SHORTCUTS.map(([group, keys]) => (
          <section key={group}>
            <h3>{group}</h3>
            <dl>
              {keys.map(([k, d]) => (
                <div key={k}>
                  <dt>{k.split("  ").map((x) => <Kbd key={x}>{x}</Kbd>)}</dt>
                  <dd>{d}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className={s.foot}>Read-only, like the TUI: the only thing this page writes is your clipboard.</p>
    </dialog>
  );
}
