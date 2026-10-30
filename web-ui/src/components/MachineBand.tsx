// Machine-level alerts (all live chats against RAM, free disk): their own band above Usage / Attention, in a violet tone and with a
// hazard-stripe edge so it cannot be mistaken for a chat's amber/red card. Snoozing only MINIMISES an alert to a chip; it stays on
// the page while the condition lasts, opens again by itself if it gets worse, and is forgotten once the condition clears.
import { useEffect, useState } from "react";
import type { SystemAlert } from "../types";
import { plural } from "../lib/format";
import { isMinimised, loadSnoozed, prune, saveSnoozed, snooze, unsnooze, type Snoozed } from "../lib/snooze";
import { Icon } from "./ui/Icon";
import { Button, cx } from "./ui/primitives";
import s from "./MachineBand.module.css";

interface Props {
  system: SystemAlert[];
  onPick: (sid: string) => void;                  // select a chat in the list
  onShowEnded: (sids: string[]) => void;          // show archived chats and select the first of these
}

const mb = (n: number) => Math.round(n).toLocaleString();

function Alert({ a, onPick, onShowEnded, onSnooze }: { a: SystemAlert; onSnooze: () => void } & Omit<Props, "system">) {
  const ended = a.reclaim_chats ?? [];
  return (
    <li className={s.alert} data-level={a.level}>
      <div className={s.alertMain}>
        <div className={s.alertHead}>
          <span className={s.lvl} data-level={a.level}>{a.level}</span>
          <Icon name={a.kind === "disk" ? "disk" : "cpu"} size={14} />
          <b className={s.title}>{a.title}</b>
        </div>
        <p className={s.headline}>{a.headline}</p>
        {a.tips.length > 0 && <ul className={s.tips}>{a.tips.map((t) => <li key={t}>{t}</li>)}</ul>}
        {a.kind === "memory" && a.culprits.length > 0 && (
          <div className={s.culprits}>
            <span className={s.k}>biggest chats</span>
            {a.culprits.map((c) => (
              <button key={c.sid} type="button" className={s.culprit} title="Show this chat" aria-label={`Show chat ${c.label}`} onClick={() => onPick(c.sid)}>
                {c.label}<b className="tnum">{mb(c.mem_mb)} MB</b>
              </button>
            ))}
          </div>
        )}
        {a.kind === "disk" && a.reclaim_mb !== undefined && (
          <div className={s.culprits}>
            <span><b className="tnum">{mb(a.reclaim_mb)} MB</b> could be freed from {plural(ended.length, "ended chat")}</span>
            {ended.length > 0 && <Button size="small" onClick={() => onShowEnded(ended)}>Show those chats</Button>}
          </div>
        )}
      </div>
      <Button size="small" variant="ghost" onClick={onSnooze} title="Shrink this to a small chip; it stays until the problem is gone">Snooze</Button>
    </li>
  );
}

export function MachineBand({ system, onPick, onShowEnded }: Props) {
  const [snoozed, setSnoozed] = useState<Snoozed>(loadSnoozed);

  // A condition that cleared is forgotten, so it comes back in full if it returns.
  useEffect(() => { setSnoozed((cur) => prune(cur, system)); }, [system]);
  useEffect(() => { saveSnoozed(snoozed); }, [snoozed]);

  if (!system.length) return null;
  const open = system.filter((a) => !isMinimised(snoozed, a));
  const chips = system.filter((a) => isMinimised(snoozed, a));
  const red = system.some((a) => a.level === "RED");
  return (
    <section className={cx(s.band, red && s.bandRed)} aria-labelledby="machine-title">
      <span className={s.stripe} aria-hidden="true" />
      <div className={s.inner}>
        <header className={s.head}>
          <Icon name="server" size={15} />
          <h2 id="machine-title">Machine</h2>
          <span className={s.count} aria-label={`${plural(system.length, "machine alert")}`}><b className="tnum">{system.length}</b>{system.length === 1 ? "alert" : "alerts"}</span>
          <span className={s.sub}>the whole computer, not one chat</span>
        </header>
        {open.length > 0 && (
          <ul className={s.list}>
            {open.map((a) => <Alert key={a.key} a={a} onPick={onPick} onShowEnded={onShowEnded} onSnooze={() => setSnoozed((cur) => snooze(cur, a))} />)}
          </ul>
        )}
        {chips.length > 0 && (
          <ul className={s.chips}>
            {chips.map((a) => (
              <li key={a.key}>
                <button type="button" className={s.chip} data-level={a.level} aria-label={`Show ${a.title}`} title="Show this alert again" onClick={() => setSnoozed((cur) => unsnooze(cur, a.key))}>
                  <Icon name={a.kind === "disk" ? "disk" : "cpu"} size={13} />
                  <span className={s.chipText}>{a.headline}</span>
                  <span className={s.dot} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
