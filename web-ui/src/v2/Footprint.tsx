// What a chat leaves on disk, and what could be tidied: a small chip for the row, a stacked bar with a legend for the details and
// the housekeeping suggestions. Commands are shown and copied, never run from the page.
import type { CSSProperties } from "react";
import type { Session } from "../types";
import { CopyBtn, I } from "./parts";

export const fmtMb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`);

const BIG = 1;      // parts under 1 MB are not worth a segment

const bigParts = (x: Session) => (x.files?.parts ?? []).filter(([, mb]) => mb >= BIG).sort((a, b) => b[1] - a[1]);

/** "412 MB" in a chip; the tooltip lists the parts. Nothing when the chat has no files. */
export function DiskChip({ x }: { x: Session }) {
  if (!x.files) return null;
  const parts = x.files.parts.map(([k, mb]) => `${k} ${fmtMb(mb)}`).join(" · ");
  return <span className="chip chip-disk" data-tone={x.files.total_mb >= 500 ? "warn" : undefined} title={`On disk: ${parts || fmtMb(x.files.total_mb)}`}><I name="archive" size={12} />{fmtMb(x.files.total_mb)}</span>;
}

/** A thin stacked bar, biggest part first, with a legend. */
export function DiskBreakdown({ x }: { x: Session }) {
  if (!x.files) return null;
  const parts = bigParts(x);
  return (
    <div className="disk" aria-label="Disk">
      <div className="disk-top"><span>Disk</span><b className="tnum">{fmtMb(x.files.total_mb)}</b></div>
      {parts.length > 0 ? (
        <>
          <div className="disk-bar" role="img" aria-label={`Disk by part: ${parts.map(([k, mb]) => `${k} ${fmtMb(mb)}`).join(", ")}`}>
            {parts.map(([k, mb], i) => <i key={k} title={`${k} ${fmtMb(mb)}`} style={{ flexGrow: mb, "--k": i } as CSSProperties} />)}
          </div>
          <ul className="disk-legend">
            {parts.map(([k, mb], i) => <li key={k}><i style={{ "--k": i } as CSSProperties} />{k}<b className="tnum">{fmtMb(mb)}</b></li>)}
          </ul>
        </>
      ) : <p className="note" style={{ margin: 0 }}>Every part is under 1 MB.</p>}
    </div>
  );
}

/** Suggestions from the server: the text, and a copy button for the command when there is one. */
export function Housekeeping({ x }: { x: Session }) {
  if (!x.advice.length) return null;
  return (
    <div className="hk" aria-label="Housekeeping">
      <div className="hk-h"><I name="info" size={13} />Housekeeping</div>
      <ul>
        {x.advice.map((a) => (
          <li key={`${a.kind}:${a.text}`}>
            <span>{a.text}</span>
            {a.command && <span className="hk-cmd"><code>{a.command}</code><CopyBtn text={a.command} what="housekeeping command" /></span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
