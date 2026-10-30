// Toasts through React context: any component calls `useToast()("Copied …")` without passing callbacks down.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import s from "./Toast.module.css";

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((text: string) => {
    setMessage({ text, id: Date.now() });            // a new id restarts the enter animation for repeated messages
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 2600);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={s.region} role="status" aria-live="polite">
        {message && <div key={message.id} className={s.toast}>{message.text}</div>}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
