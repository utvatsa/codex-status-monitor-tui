// One keydown listener for the whole page. `keymap` maps a key (as in KeyboardEvent.key) to a handler.
// Keys are ignored while typing in a field (except Escape), and when a modifier is held, so browser shortcuts
// like ⌘C or ⌘R keep working.
import { useEffect, useRef } from "react";

export type Keymap = Record<string, (e: KeyboardEvent) => void>;

export function useHotkeys(keymap: Keymap, options: { onTypingEscape?: (target: HTMLElement) => void } = {}): void {
  // Keep the latest keymap in a ref so the listener is added once, yet always calls fresh handlers.
  const ref = useRef({ keymap, options });
  ref.current = { keymap, options };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (typing) {
        if (e.key === "Escape" && target) ref.current.options.onTypingEscape?.(target);
        return;
      }
      const handler = ref.current.keymap[e.key];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
