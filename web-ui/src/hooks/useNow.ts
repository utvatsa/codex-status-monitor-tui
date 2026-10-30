import { useEffect, useState } from "react";

/** The current time in unix seconds, re-rendering every `ms` milliseconds (for "updated 3s ago"). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
