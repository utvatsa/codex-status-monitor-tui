// Subscribe to the server's live stream (Server-Sent Events on /api/events).
// The server sends the full snapshot right away and again after every read; the browser's EventSource reconnects
// on its own, and when it gives up we retry slowly, so the page comes back by itself when the server restarts.
import { useEffect, useState } from "react";
import type { Connection, Snapshot } from "../types";

export function useSnapshot(url = "/api/events"): { snapshot: Snapshot | null; connection: Connection } {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");

  useEffect(() => {
    let es: EventSource | null = null;
    let fails = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const open = () => {
      es = new EventSource(url);
      es.addEventListener("snapshot", (e) => {
        fails = 0;
        setConnection("live");
        try {
          setSnapshot(JSON.parse((e as MessageEvent<string>).data) as Snapshot);
        } catch {
          /* a broken frame: the next one replaces it */
        }
      });
      es.onopen = () => {
        fails = 0;
        setConnection("live");
      };
      es.onerror = () => {
        fails += 1;
        setConnection(fails >= 3 ? "stopped" : "retrying");
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          clearTimeout(retry);
          retry = setTimeout(open, 3000);
        }
      };
    };

    open();
    return () => {                       // React runs this when the component goes away (or twice in dev StrictMode)
      clearTimeout(retry);
      es?.close();
    };
  }, [url]);

  return { snapshot, connection };
}

/** Ask the data owner (the TUI or the --web loop) to read again; `archived` also asks it to read archived chats. */
export function requestRefresh(archived: boolean): Promise<unknown> {
  return fetch("/api/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived }),
  }).catch(() => null);
}
