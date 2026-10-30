// Machine alerts (RAM across all live chats, free disk): their own band above the overview, in an indigo tone with a moving hazard
// stripe, so they are never mistaken for a chat's alert. Snoozing only MINIMISES an alert to a small chip: it stays while the problem
// lasts, opens again when it gets worse (AMBER to RED), and is forgotten when the problem clears. Nothing is shown when all is well.
import { useEffect, useState, type CSSProperties } from "react";
import { plural } from "../lib/format";
import { isMinimised, loadSnoozed, prune, saveSnoozed, snooze, unsnooze, type Snoozed } from "../lib/snooze";
import type { SystemAlert } from "../types";
import { I, Orb } from "./parts";

function Alert({ a, onPick, onArchived, onSnooze }: { a: SystemAlert; onPick: (sid: string) => void; onArchived: (sid: string) => void; onSnooze: () => void }) {
  const freed = a.reclaim_mb ?? 0, ended = a.reclaim_chats ?? [];
  return (
    <article className="mach-a" data-level={a.level} aria-label={a.title}>
      <div className="mach-a-top">
        <Orb health={a.level} />
        <b className="mach-title">{a.title}</b>
        <span className="chip" data-tone={a.level === "RED" ? "bad" : "warn"}>{a.level}</span>
        <button type="button" className="btn mach-snooze" onClick={onSnooze} title="Minimise this alert to a small chip; it comes back in full if it gets worse"><I name="chevron" size={14} />Snooze</button>
      </div>
      <p className="mach-head">{a.headline}</p>
      {a.tips.length > 0 && <ul className="mach-tips">{a.tips.map((t) => <li key={t}>{t}</li>)}</ul>}
      {a.kind === "memory" && a.culprits.length > 0 && (
        <div className="mach-culp"><span>Biggest chats</span>
          {a.culprits.map((c) => (
            <button key={c.sid} type="button" className="chip chip-btn" data-tone="violet" title={`Open ${c.label}`} onClick={() => onPick(c.sid)}>{c.label}<b>{Math.round(c.mem_mb).toLocaleString()} MB</b></button>
          ))}
        </div>
      )}
      {a.kind === "disk" && freed > 0 && ended.length > 0 && (
        <div className="mach-culp">
          <span>{Math.round(freed).toLocaleString()} MB could be freed from {plural(ended.length, "ended chat")}</span>
          <button type="button" className="btn" onClick={() => onArchived(ended[0])}><I name="archive" size={14} />Show those chats</button>
        </div>
      )}
    </article>
  );
}

export function Machine({ alerts, onPick, onArchived }: { alerts: SystemAlert[]; onPick: (sid: string) => void; onArchived: (sid: string) => void }) {
  const [snoozed, setSnoozed] = useState<Snoozed>(loadSnoozed);
  const sig = alerts.map((a) => `${a.key}:${a.level}`).join("|");

  // Whenever the list changes, forget snoozes that no longer apply (cleared alerts, and ones that escalated): prune decides.
  useEffect(() => {
    setSnoozed((s) => {
      const n = prune(s, alerts);
      if (n !== s) saveSnoozed(n);
      return n;
    });
  }, [sig]);     // eslint-disable-line react-hooks/exhaustive-deps

  if (!alerts.length) return null;
  const change = (n: Snoozed) => { setSnoozed(n); saveSnoozed(n); };
  const full = alerts.filter((a) => !isMinimised(snoozed, a)), small = alerts.filter((a) => isMinimised(snoozed, a));
  const red = alerts.some((a) => a.level === "RED");
  return (
    <section className="mach glass rise" data-level={red ? "RED" : "AMBER"} aria-label="Machine alerts" style={{ "--i": 1 } as CSSProperties}>
      <h3>
        <I name="server" size={15} />Machine
        <span className="mach-count" aria-label={`${plural(alerts.length, "machine alert")}`}><b>{alerts.length}</b></span>
        <span className="h3-n">the whole computer, not one chat</span>
      </h3>
      {full.map((a) => <Alert key={a.key} a={a} onPick={onPick} onArchived={onArchived} onSnooze={() => change(snooze(snoozed, a))} />)}
      {small.length > 0 && (
        <div className="mach-chips">
          {small.map((a) => (
            <button key={a.key} type="button" className="mach-chip" data-level={a.level} aria-label={`Show ${a.title}: ${a.headline}`} title="Click to expand again" onClick={() => change(unsnooze(snoozed, a.key))}>
              <I name="server" size={13} /><span>{a.headline}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
