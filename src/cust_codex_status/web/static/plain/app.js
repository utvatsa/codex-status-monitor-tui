// Web view of cust-codex-status: the same report as the TUI, fed by the snapshots the TUI (or `--web`) publishes.
// No build step: Preact + htm come from one vendored module. All rules (health, tips, formatting) arrive pre-computed
// from Python, so this file only lays things out and handles keys, clicks and copying.
import { html, render, useState, useEffect, useRef, useCallback, useMemo } from "./vendor/preact-htm.mjs";
import {
  SOURCE_TEXT, SIZE_OPTIONS, KIND_LABEL, parseSize, sizeText, showSize, suggestLevels, tokOf, pctOf, rowFor, problemOf, chatCommand,
  attentionItems, loadSnoozed, saveSnoozed, isMinimised, snooze, unsnooze, prune,
} from "./alerts.mjs";

const VIEWS = ["minimal", "compact", "lean", "standard", "full"];
const LEVEL_REPS = [10, 30, 60, 75, 95];
const STORE = "cust-codex-status.web";
const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(Math.round(n || 0)));
const THEMES = [["auto", "Auto (system)"], ["light", "Light"], ["dark", "Dark"], ["paper", "Light · Paper"], ["nord", "Dark · Nord"], ["dracula", "Dark · Dracula"]];
const nextTheme = (t) => THEMES[(THEMES.findIndex(([k]) => k === t) + 1) % THEMES.length][0];

// --- small helpers ------------------------------------------------------------------------------------------------

function viewIndex(level) {
  return level < 20 ? 0 : level < 45 ? 1 : level < 70 ? 2 : level < 90 ? 3 : 4;
}

// The same dial as views.apply_level: a level sets the baseline; the toggles below can flip a flag until the level changes.
function flagsFor(level) {
  return { minimal: level < 20, compact: level < 45, lean: level < 70, noPrompts: level < 90, showArc: level >= 90, verbose: level >= 90 };
}

// Saved per-browser settings, then ?level=0-100 and ?theme=light|dark|auto from the address (handy for bookmarks).
function load() {
  let v = {};
  try { v = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { /* no storage: defaults */ }
  const q = new URLSearchParams(location.search);
  if (q.has("level") && !isNaN(+q.get("level"))) v.level = Math.max(0, Math.min(100, +q.get("level")));
  if (THEMES.some(([k]) => k === q.get("theme"))) v.theme = q.get("theme");
  return v;
}

function save(v) {
  try { localStorage.setItem(STORE, JSON.stringify(v)); } catch (e) { /* private window: settings just are not kept */ }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.className = "offscreen";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function since(sec) {
  sec = Math.max(0, Math.round(sec));
  return sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.floor(sec / 60)}m` : `${Math.floor(sec / 3600)}h`;
}

function tone(pct) {
  return pct >= 85 ? "bad" : pct >= 60 ? "warn" : "good";
}

function postRefresh(archived) {
  return fetch("/api/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: !!archived }) })
    .catch(() => null);
}

// The one thing this page may change: ONE chat's context window and alert levels, through POST /api/config. Every editor also shows
// the equivalent command, so a refused or failed write is never a dead end.
async function postConfig(chat) {
  try {
    const r = await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat }) });
    if (r.ok) return { ok: true };
    const d = await r.json().catch(() => ({}));
    return { ok: false, error: d.error || `the server said ${r.status}` };
  } catch (e) {
    return { ok: false, error: "the server is not reachable" };
  }
}

// The app's toast, for the pieces below that are not given a callback (set once by App).
let tell = () => {};

const mbText = (n) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString();

// --- live data: Server-Sent Events, reconnecting on its own ----------------------------------------------------------

function useSnapshot() {
  const [snap, setSnap] = useState(null);
  const [conn, setConn] = useState("connecting");
  useEffect(() => {
    let es, fails = 0, timer;
    const open = () => {
      es = new EventSource("/api/events");
      es.addEventListener("snapshot", (e) => {
        fails = 0;
        setConn("live");
        try { setSnap(JSON.parse(e.data)); } catch (err) { /* a partial frame: the next one will do */ }
      });
      es.onopen = () => { fails = 0; setConn("live"); };
      es.onerror = () => {
        fails += 1;
        setConn(fails >= 3 ? "stopped" : "retrying");
        if (es.readyState === EventSource.CLOSED) {          // the browser gave up: try again ourselves, slowly
          es.close();
          clearTimeout(timer);
          timer = setTimeout(open, 3000);
        }
      };
    };
    open();
    return () => { clearTimeout(timer); es && es.close(); };
  }, []);
  return [snap, conn];
}

function useNow(ms) {
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// --- pieces ------------------------------------------------------------------------------------------------------

const Badge = ({ level, big }) => html`<span class=${`badge badge-${level.toLowerCase()}${big ? " badge-big" : ""}`}>${level}</span>`;

const Key = ({ k }) => html`<kbd>${k}</kbd>`;

// `levels` = [amber %, red %] of this bar's own scale: the fill turns amber / red there and two ticks mark them.
function Bar({ pct, small, levels }) {
  const v = Math.max(0, Math.min(100, pct));
  const t = levels ? (v >= levels[1] ? "bad" : v >= levels[0] ? "warn" : "good") : tone(v);
  return html`<span class=${`bar ${small ? "bar-sm" : ""} tone-${t}`} role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${pct}
      title=${levels ? `alerts at ${levels[0]}% (amber) and ${levels[1]}% (red)` : undefined}>
    <span class="bar-fill" style=${{ width: `${v}%` }}></span>
    ${levels ? html`<i class="mark mark-amber" style=${{ left: `${levels[0]}%` }}></i><i class="mark mark-red" style=${{ left: `${levels[1]}%` }}></i>` : ""}
  </span>`;
}

function State({ s }) {
  return html`<span class=${`state state-${s.state.replace("?", "")}`}><i></i>${s.state}${s.waiting ? "*" : ""}</span>`;
}

function Ctx({ s, small }) {
  return html`<span class="ctx" title=${`last turn's input + cache: ${s.ctx} of a ${s.window} window; this chat's alerts start at ${s.ctx_amber} (amber) and ${s.ctx_red} (red)`}>
    <${Bar} pct=${s.ctx_pct} small=${small} levels=${[s.ctx_amber_pct, s.ctx_red_pct]} />
    <b>${s.ctx_pct}%</b>${s.maybe_1m ? html`<abbr title="85%+ of an assumed 200k window; it may really be a 1M window">~</abbr>` : ""}
    ${small ? "" : html`<span class="dim">${s.ctx}/${s.window}</span>`}
  </span>`;
}

function CopyButton({ text, what, onCopied, label }) {
  return html`<button class="btn btn-ghost btn-xs" title=${`Copy the ${what}`} onClick=${(e) => { e.stopPropagation(); onCopied(text, what); }}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="2"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/></svg>
    ${label || "Copy"}
  </button>`;
}

function Cmd({ label, text, what, onCopied, note }) {
  return html`<div class="kv kv-cmd">
    <span class="k">${label}</span>
    <code class="cmd">${text}</code>
    <${CopyButton} text=${text} what=${what} onCopied=${onCopied} />
    ${note ? html`<span class="note">${note}</span>` : ""}
  </div>`;
}

// What the chat leaves on disk: the total, and the parts of 1 MB or more (biggest first, as the server sends them).
function Footprint({ s, totalOnly }) {
  if (!s.files) return "";
  const parts = totalOnly ? [] : s.files.parts.filter(([, size]) => size >= 1);
  return html`<span class="footprint" title="what this chat leaves on disk (transcript, tool results, file history, temp files)">
    ${totalOnly ? "" : "Disk "}<b>${mbText(s.files.total_mb)} MB</b>${parts.map(([name, size]) => html` · ${name} ${mbText(size)}`)}
  </span>`;
}

// The server's suggestions for tidying a chat. Commands are shown and copied, never run from the page.
function Housekeeping({ s, onCopied, showCommand }) {
  if (!s.advice.length) return "";
  return html`<div class="advice" aria-label="Housekeeping">
    <b class="advice-head">Housekeeping</b>
    ${s.advice.map((a) => html`<div class="advice-item">
      <span>${a.text}</span>
      ${a.command && showCommand ? html`<code class="cmd">${a.command}</code>` : ""}
      ${a.command ? html`<${CopyButton} text=${a.command} what="housekeeping command" onCopied=${onCopied} label="Copy command" />` : ""}
    </div>`)}
  </div>`;
}

// Changing the context window of ONE chat: a menu for the maximum, two linked threshold rows (percent and tokens), a plain summary with
// a zone bar, and the equivalent command. "full" in the details, "compact" in the Attention panel's offer. Never a model-wide setting.
function WindowEditor({ sid, size, levels, canReset, variant, onClose, onCopied }) {
  const listed = SIZE_OPTIONS.find(([v]) => v !== "custom" && parseSize(v) === size);
  const [pick, setPick] = useState(listed ? listed[0] : "custom");
  const [custom, setCustom] = useState(sizeText(size));
  const start = levels || suggestLevels(size);
  const [amber, setAmber] = useState(rowFor(size, start[0]));
  const [red, setRed] = useState(rowFor(size, start[1]));
  const [edited, setEdited] = useState({ amber: !!levels, red: !!levels });       // a row typed by hand keeps its percentage when the maximum changes
  const [more, setMore] = useState(variant === "full");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);

  const sizeArg = (pick === "custom" ? custom : pick).trim().toLowerCase();
  const max = parseSize(sizeArg);
  const suggested = max !== null ? suggestLevels(max) : null;

  const changeMax = (nextPick, nextCustom) => {
    setPick(nextPick);
    setCustom(nextCustom);
    const m = parseSize(nextPick === "custom" ? nextCustom : nextPick);
    if (m === null) return;
    const [sa, sr] = suggestLevels(m);
    setAmber((r) => rowFor(m, edited.amber ? Number(r.pct) || 0 : sa));
    setRed((r) => rowFor(m, edited.red ? Number(r.pct) || 0 : sr));
  };
  const edit = (which, field, v) => {
    const set = which === "amber" ? setAmber : setRed;
    setEdited((e) => ({ ...e, [which]: true }));
    set(field === "pct" ? { pct: v, tok: tokOf(max, v) } : { tok: v, pct: pctOf(max, v) });
  };
  const useSuggested = () => { setEdited({ amber: false, red: false }); setAmber(rowFor(max, suggested[0])); setRed(rowFor(max, suggested[1])); };

  const a = Number(amber.pct), r = Number(red.pct);
  const problem = problemOf(max, amber, red);
  const command = problem ? null : chatCommand(sid, sizeArg, a, r);

  const run = async (job, done) => {
    setBusy(true);
    setFailed(null);
    const res = await job();
    setBusy(false);
    if (res.ok) { tell(done); if (onClose) onClose(); }
    else setFailed(res.error || "the change was not saved");
  };

  return html`<div class=${`editor ${variant === "compact" ? "editor-compact" : ""}`} role="group" aria-label="Change the context window" onClick=${(e) => e.stopPropagation()}>
    <p class="scope">Applies to <b>this chat only</b>. Other chats and the model's default are not changed.</p>
    <div class="max-row">
      <label>Maximum context
        <select value=${pick} onChange=${(e) => changeMax(e.target.value, custom)}>
          ${SIZE_OPTIONS.map(([v, label]) => html`<option value=${v}>${label}</option>`)}
        </select>
      </label>
      ${pick === "custom" ? html`<label>Custom size
        <input value=${custom} onInput=${(e) => changeMax("custom", e.target.value)} placeholder="e.g. 750k" spellcheck="false" /></label>` : ""}
    </div>
    ${variant === "compact" ? html`<button type="button" class="btn-link" aria-expanded=${more} onClick=${() => setMore(!more)}>${more ? "Hide thresholds" : "Edit thresholds"}</button>` : ""}
    ${more ? html`<div class="thresholds">
      ${[["amber", "Amber", amber], ["red", "Red", red]].map(([key, label, row]) => html`<div class="th-row" data-zone=${key}>
        <span class="th-label">${label}</span>
        <input type="number" min="1" max="100" aria-label=${`${label} percent`} value=${row.pct} onInput=${(e) => edit(key, "pct", e.target.value)} />
        <span class="eq">% =</span>
        <input aria-label=${`${label} tokens`} value=${row.tok} spellcheck="false" onInput=${(e) => edit(key, "tok", e.target.value)} />
      </div>`)}
      ${suggested ? html`<button type="button" class="btn-link" onClick=${useSuggested}>Use suggested (${suggested[0]}% / ${suggested[1]}%)</button>` : ""}
    </div>` : ""}
    ${problem ? html`<p class="error" role="alert">${problem}</p>` : html`
      <p class="summary-line">Alerts at <b>${showSize(Math.round(max * a / 100))}</b> (amber) and <b>${showSize(Math.round(max * r / 100))}</b> (red) of <b>${showSize(max)}</b>.</p>
      <span class="zones" role="img" aria-label=${`ok up to ${a}%, amber ${a}% to ${r}%, red from ${r}%`}>
        <i class="z-ok" style=${{ width: `${a}%` }}></i><i class="z-amber" style=${{ width: `${r - a}%` }}></i><i class="z-red" style=${{ width: `${100 - r}%` }}></i>
      </span>`}
    ${failed ? html`<p class="error" role="alert">Not saved: ${failed}. Run the command below instead.</p>` : ""}
    <div class="actions">
      <button class="btn btn-primary btn-xs" disabled=${!!problem || busy}
        onClick=${() => run(() => postConfig({ sid, window: sizeArg, amber: a, red: r }), `Window set to ${showSize(max)} for this chat`)}>Apply to this chat</button>
      ${variant === "full" ? html`<button class="btn btn-ghost btn-xs" onClick=${onClose} disabled=${busy}>Cancel</button>` : ""}
      ${canReset ? html`<button class="btn btn-xs" disabled=${busy}
        onClick=${() => run(() => postConfig({ sid, clear: true }), "Back to automatic for this chat")}>Reset to automatic</button>` : ""}
    </div>
    <div class="kv kv-cmd">
      <span class="k">or run</span>
      <code class="cmd">${command || "fix the values above to see the command"}</code>
      ${command ? html`<${CopyButton} text=${command} what="set-window command" onCopied=${onCopied} label="Copy command" />` : ""}
    </div>
  </div>`;
}

// The chat's window and where it came from, with a Change button that opens the editor in place.
function WindowControl({ s, onCopied }) {
  const [open, setOpen] = useState(false);
  return html`<div class="winctl" onClick=${(e) => e.stopPropagation()}>
    <div class="kv"><span class="k">window</span>
      <span class="v"><b>${s.window}</b> · ${SOURCE_TEXT[s.window_source] || s.window_source}
        <span class="dim"> · alerts at ${s.ctx_amber} / ${s.ctx_red} (${s.ctx_amber_pct}% / ${s.ctx_red_pct}%)</span></span>
      ${open ? "" : html`<button class="btn btn-xs" aria-label="Change the context window" onClick=${() => setOpen(true)}>Change</button>`}
    </div>
    ${open ? html`<${WindowEditor} sid=${s.sid} size=${s.window_tokens} levels=${s.levels_custom ? [s.ctx_amber_pct, s.ctx_red_pct] : undefined}
      canReset=${s.window_source === "chat"} variant="full" onClose=${() => setOpen(false)} onCopied=${onCopied} />` : ""}
  </div>`;
}

function Stats({ s }) {
  const sb = s.subagents;
  const running = sb.filter((a) => a.running).length;
  return html`<div class="stats">
    <span><em>turns</em> ${s.turns}</span><span><em>in</em> ${s.inp}</span><span><em>cached</em> ${s.cache_r}</span><span><em>out</em> ${s.out}</span>
    <span><em>reasoning</em> ${s.reasoning}</span>
    ${sb.length ? html`<span><em>subagents</em> ${running}/${sb.length}</span>` : ""}
    ${s.active && s.mem_mb ? html`<span><em>mem</em> ${s.mem_mb}MB</span>` : ""}
  </div>`;
}

function Reason({ s }) {
  return s.why.length
    ? html`<div class=${`reason reason-${s.health.toLowerCase()}`}>${s.why.join(" · ")}</div>`
    : html`<div class="reason reason-ok">nothing needs attention</div>`;
}

function Tips({ s }) {
  return s.tips.length ? html`<ul class="tips">${s.tips.map((t) => html`<li>${t}</li>`)}</ul>` : "";
}

function Prompts({ s }) {
  return html`
    <div class="kv"><span class="k">first</span><span class="v prompt">${s.first_prompt || "-"}</span></div>
    <div class="kv"><span class="k">latest</span><span class="v prompt">${s.latest_prompt || "-"}</span></div>`;
}

function Subagents({ s, all }) {
  const list = all ? s.subagents : s.subagents.slice(0, 3);
  if (!list.length) return "";
  return html`<div class="subs">
    <div class="subs-head">subagents ${all ? "" : html`<span class="dim">(latest 3 · <${Key} k="s" /> for all)</span>`}</div>
    ${list.map((a) => html`<div class="sub">
      <span class=${a.running ? "sub-run" : "sub-done"}>${a.running ? "◐" : "✓"}</span>
      <span class="sub-type">${a.type}</span><span class="sub-desc">${a.desc}</span>
      <span class="dim">${a.model} · ${a.ctx} ctx · ${a.ago}</span>
    </div>`)}
  </div>`;
}

// What a collapsed row shows once it is selected (or expanded with the chevron): the TUI's detail_lines.
function Details({ s, onCopied, prompts = true }) {
  return html`<div class="details">
    <div class="kv"><span class="k">folder</span><span class="v mono">${s.folder}</span></div>
    <div class="kv"><span class="k">id</span><span class="v mono">${s.sid}${s.pid ? html` <span class="dim">pid ${s.pid}</span>` : ""}</span>
      <${CopyButton} text=${s.sid} what="session id" onCopied=${onCopied} label="Copy id" /></div>
    <div class="kv"><span class="k">stats</span><${Stats} s=${s} /></div>
    ${s.files ? html`<div class="kv"><span class="k">disk</span><${Footprint} s=${s} /></div>` : ""}
    <${WindowControl} s=${s} onCopied=${onCopied} />
    ${prompts ? html`<${Prompts} s=${s} />` : ""}
    <${Cmd} label="resume" text=${s.resume} what="resume command" onCopied=${onCopied}
      note=${s.active ? `live in ${s.running_in}: close it there first, or add --fork-session` : ""} />
    <${Cmd} label="clean" text=${s.clean} what="fresh-chat command" onCopied=${onCopied} />
    <${Tips} s=${s} />
    <${Housekeeping} s=${s} onCopied=${onCopied} showCommand />
  </div>`;
}

function Card({ s, n, f, nav, sel, onPick, onCopied }) {
  const title = (s.name && s.active ? `${s.name} · ` : "") + s.title;
  return html`<article data-sid=${s.sid} class=${`card ${s.active ? "card-live" : "card-arc"} ${nav ? "is-nav" : ""} ${sel ? "is-sel" : ""}`}
      onClick=${() => onPick(s.sid)} aria-selected=${sel}>
    <header class="card-head">
      <span class="num">${n}</span>
      <span class=${f.lean ? "" : "only-narrow"}><${Badge} level=${s.health} /></span>
      <h3 title=${title}>${title}</h3>
      <span class="where">${s.running_in}</span>
    </header>
    <div class=${f.lean ? "card-body" : "card-body card-body-wide"}>
      ${f.lean ? "" : html`<${Badge} level=${s.health} big />`}
      <div class="card-main">
        <div class="line">
          <${State} s=${s} /><span class="model">${s.model}</span><${Ctx} s=${s} />
          <span class="dim">last ${s.last}${s.up ? ` · up ${s.up}` : ""}</span>
        </div>
        ${f.lean ? (s.why.length ? html`<${Reason} s=${s} />` : "") : html`<${Reason} s=${s} />`}
        <${Stats} s=${s} />
        ${f.lean ? "" : html`<${Footprint} s=${s} />`}
        ${f.lean ? "" : html`
          <div class="kv"><span class="k">folder</span><span class="v mono">${s.folder}</span></div>
          <div class="kv"><span class="k">id</span><span class="v mono">${s.sid}${s.pid ? html` <span class="dim">pid ${s.pid}</span>` : ""}</span>
            <${CopyButton} text=${s.sid} what="session id" onCopied=${onCopied} label="Copy id" /></div>`}
        ${!f.noPrompts && !f.lean ? html`<${Prompts} s=${s} />` : ""}
        <${Cmd} label="resume" text=${s.resume} what="resume command" onCopied=${onCopied}
          note=${!f.lean && s.active ? `live in ${s.running_in}: close it there first, or add --fork-session` : ""} />
        ${f.lean ? "" : html`<${WindowControl} s=${s} onCopied=${onCopied} />
          <${Cmd} label="clean" text=${s.clean} what="fresh-chat command" onCopied=${onCopied} /><${Tips} s=${s} /><${Housekeeping} s=${s} onCopied=${onCopied} />`}
        ${f.verbose || f.allSubagents ? html`<${Subagents} s=${s} all=${f.allSubagents} />` : ""}
      </div>
    </div>
  </article>`;
}

function Row({ s, n, f, nav, sel, open, onPick, onToggle, onCopied, archived }) {
  const showDetails = sel || open;
  return html`<div data-sid=${s.sid} class=${`row ${archived ? "row-arc" : ""} ${nav ? "is-nav" : ""} ${sel ? "is-sel" : ""}`}
      onClick=${() => onPick(s.sid)} aria-selected=${sel}>
    <div class="row-main">
      <span class="num">${n}</span>
      <${Badge} level=${s.health} />
      ${archived ? "" : html`<${State} s=${s} />`}
      <span class="row-title" title=${s.label}>${archived ? s.title : s.label}</span>
      <span class="where">${archived ? s.source : s.running_in}</span>
      <span class="model">${s.model}</span>
      <${Ctx} s=${s} small />
      ${archived ? html`<span class="cost">${s.tokens}</span>` : ""}
      <span class="dim ago">${s.last}</span>
      <button class=${`btn btn-icon chev ${showDetails ? "is-open" : ""}`} title=${showDetails ? "Collapse" : "Expand"}
        aria-expanded=${showDetails} onClick=${(e) => { e.stopPropagation(); onToggle(s.sid); }}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>
      </button>
    </div>
    ${showDetails ? html`<${Details} s=${s} onCopied=${onCopied} />` : html`
      ${archived && f.arcPrompt ? html`<div class="row-sub"><span class="k">latest</span> <span class="prompt">${s.latest_prompt || "-"}</span></div>` : ""}
      ${s.files ? html`<div class="row-sub dim"><${Footprint} s=${s} totalOnly /></div>` : ""}
      ${archived ? html`<div class="row-sub mono dim">${s.resume}</div>` : ""}`}
    ${archived && s.why.length ? html`<div class=${`row-sub reason reason-${s.health.toLowerCase()}`}>▲ ${s.why.join(" · ")}</div>` : ""}
  </div>`;
}

function Panel({ title, right, tone: t, children, id }) {
  return html`<section class=${`panel ${t ? `panel-${t}` : ""}`} id=${id}>
    <header class="panel-head"><h2>${title}</h2>${right ? html`<span class="dim">${right}</span>` : ""}</header>
    ${children}
  </section>`;
}

function Usage({ u }) {
  if (!u.limits.length) return html`<p class="empty">No rate-limit data yet. It is read from the latest token_count event of a Codex session.</p>`;
  return html`<div class="limits">
    ${u.limits.map((l) => html`<div class="limit">
      <span class="limit-label">${l.label}</span>
      <${Bar} pct=${l.pct} />
      <b class="limit-pct">${l.pct}%</b>
      <span class="dim">resets in ${l.resets}</span>
      ${l.binding ? html`<span class="pill pill-warn">binding</span>` : ""}
    </div>`)}
    ${u.pools.map((p) => html`<div class="limit"><span class="limit-label">credit pool</span><span class="limit-text">${p}</span></div>`)}
    <div class=${`cached ${u.stale ? "is-stale" : ""}`}>cached ${u.cached_ago} ago${u.stale ? " · STALE: send a message in any Codex session to refresh" : ""}</div>
  </div>`;
}

// Machine-level alerts (all live chats against RAM, free disk): their own band above Usage / Attention, in a violet tone with a
// hazard-stripe edge, so it cannot be mistaken for a chat's amber/red item. Snoozing only MINIMISES an alert to a chip; it stays on
// the page while the condition lasts, opens again by itself if it gets worse, and is forgotten once the condition clears.
function MachineBand({ system, onPick, onShowEnded }) {
  const [snoozed, setSnoozed] = useState(() => loadSnoozed(localStorage));
  useEffect(() => { setSnoozed((cur) => prune(cur, system)); }, [system]);
  useEffect(() => { saveSnoozed(localStorage, snoozed); }, [snoozed]);
  if (!system.length) return "";
  const open = system.filter((a) => !isMinimised(snoozed, a));
  const chips = system.filter((a) => isMinimised(snoozed, a));
  const red = system.some((a) => a.level === "RED");
  return html`<section class=${`machine ${red ? "machine-red" : ""}`} aria-labelledby="machine-title">
    <span class="machine-stripe" aria-hidden="true"></span>
    <div class="machine-inner">
      <header class="machine-head">
        <h2 id="machine-title">Machine</h2>
        <span class="machine-count"><b>${system.length}</b>${system.length === 1 ? "alert" : "alerts"}</span>
        <span class="dim">the whole computer, not one chat</span>
      </header>
      ${open.length ? html`<ul class="machine-list">${open.map((a) => {
        const ended = a.reclaim_chats || [];
        return html`<li class="machine-alert" key=${a.key}>
          <div class="machine-main">
            <div class="machine-title"><span class="lvl" data-level=${a.level}>${a.level}</span><b>${a.title}</b></div>
            <p class="machine-headline">${a.headline}</p>
            ${a.tips.length ? html`<ul class="machine-tips">${a.tips.map((t) => html`<li>${t}</li>`)}</ul>` : ""}
            ${a.kind === "memory" && a.culprits.length ? html`<div class="culprits"><span class="k">biggest chats</span>
              ${a.culprits.map((c) => html`<button type="button" class="culprit" title="Show this chat" onClick=${() => onPick(c.sid)}>${c.label}<b>${mbText(c.mem_mb)} MB</b></button>`)}</div>` : ""}
            ${a.kind === "disk" && a.reclaim_mb !== undefined ? html`<div class="culprits">
              <span><b>${mbText(a.reclaim_mb)} MB</b> could be freed from ${ended.length} ended ${ended.length === 1 ? "chat" : "chats"}</span>
              ${ended.length ? html`<button type="button" class="btn btn-xs" onClick=${() => onShowEnded(ended)}>Show those chats</button>` : ""}</div>` : ""}
          </div>
          <button type="button" class="btn btn-ghost btn-xs" title="Shrink this to a small chip; it stays until the problem is gone"
            onClick=${() => setSnoozed((cur) => snooze(cur, a))}>Snooze</button>
        </li>`;
      })}</ul>` : ""}
      ${chips.length ? html`<ul class="machine-chips">${chips.map((a) => html`<li key=${a.key}>
        <button type="button" class="machine-chip" data-level=${a.level} aria-label=${`Show ${a.title}`} title="Show this alert again"
          onClick=${() => setSnoozed((cur) => unsnooze(cur, a.key))}><span class="chip-text">${a.headline}</span><i class="chip-dot"></i></button>
      </li>`)}</ul>` : ""}
    </div>
  </section>`;
}

// What needs the user among chats and usage limits: one line each, opening to the details. A chat whose window is only a guess and is
// nearly full gets the compact editor (1M preselected) right here. Machine alerts are not in this panel.
function Attention({ items, onCopied }) {
  const [open, setOpen] = useState({});
  const red = items.some((i) => i.level === "RED");
  return html`<${Panel} title="Attention" tone=${red ? "bad" : "warn"} right=${`${items.length} ${items.length === 1 ? "item" : "items"}`}>
    <ul class="attn">${items.map((i) => {
      const isOpen = open[i.key] ?? !!i.offer;
      return html`<li class="attn-item" key=${i.key} data-level=${i.level}>
        <button type="button" class="attn-summary" aria-expanded=${isOpen} onClick=${() => setOpen((o) => ({ ...o, [i.key]: !isOpen }))}>
          <span class="attn-line"><${Badge} level=${i.level} /><b class="attn-title">${i.title}</b></span>
          <span class="attn-headline">${i.headline}</span>
          <span class="attn-meta dim">${[KIND_LABEL[i.kind], i.where, i.model].filter(Boolean).join(" · ")}</span>
        </button>
        ${isOpen ? html`<div class="attn-more">
          ${i.pct !== null ? html`<${Bar} pct=${i.pct} />` : ""}
          ${i.folder ? html`<div class="kv"><span class="k">folder</span><span class="v mono">${i.folder}</span></div>` : ""}
          ${i.windowText ? html`<div class="kv"><span class="k">window</span><span class="v">${i.windowText}</span></div>` : ""}
          ${i.resets ? html`<div class="kv"><span class="k">resets</span><span class="v">in ${i.resets}</span></div>` : ""}
          ${i.offer ? html`<div class="offer">
            <p>This chat is judged against an assumed 200k window. If its real window is bigger, set it here.</p>
            <${WindowEditor} sid=${i.offer.sid} size=${parseSize(i.offer.size) || 1000000} canReset=${false} variant="compact" onCopied=${onCopied} />
          </div>` : ""}
          ${i.reasons.length > 1 ? html`<ul class="tips">${i.reasons.map((r) => html`<li>${r}</li>`)}</ul>` : ""}
          ${i.tips.length ? html`<p class="attn-do"><b>What to do:</b> ${i.tips.join(" ")}</p>` : ""}
          ${i.link || i.resume ? html`<div class="actions">
            ${i.link ? html`<a class="btn btn-xs" href=${i.link.href}>${i.link.label} ↗</a>` : ""}
            ${i.resume ? html`<${CopyButton} text=${i.resume} what="resume command" onCopied=${onCopied} label="Copy resume command" />` : ""}
          </div>` : ""}
        </div>` : ""}
      </li>`;
    })}</ul>
  <//>`;
}

const KEYS_SHORT = [["↑ ↓", "move"], ["⏎", "select / copy resume"], ["Esc", "back"], ["+ −", "view"], ["a", "archived"], ["/", "filter"], ["?", "all keys"]];
const KEYS_ALL = [
  ["↑ ↓ / j k / Tab", "move the highlight"], ["⏎", "select the highlighted chat (rows expand); again: copy its resume command"],
  ["y", "copy the resume command"], ["i", "copy the session id"], ["f", "copy the fresh-chat command"],
  ["Esc / b", "back to the list (or clear the filter)"], ["+ / −", "more / less detail"], ["1 – 5", "jump to a view"],
  ["a", "archived chats on/off"], ["c", "compact rows on/off"], ["p", "prompts on/off"], ["v", "subagents (latest 3) on/off"],
  ["s", "all subagents on/off"], ["t", "archived prompt line on/off"], ["e", "expand / collapse all rows"], ["u", "account details on/off"],
  ["r", "refresh now"], ["/", "filter chats by title, folder or id"], ["d", "next theme (auto, light, dark, paper, nord, dracula)"], ["g / G", "first / last chat"], ["?", "this list"],
];

function Help({ onClose }) {
  return html`<div class="overlay" onClick=${onClose}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick=${(e) => e.stopPropagation()}>
      <header class="panel-head"><h2>Keyboard shortcuts</h2><button class="btn btn-ghost btn-xs" onClick=${onClose}>Close</button></header>
      <dl class="keys">${KEYS_ALL.map(([k, d]) => html`<dt><${Key} k=${k} /></dt><dd>${d}</dd>`)}</dl>
      <p class="dim">The page only reads Codex's data. It writes your clipboard, and, when you press Apply, the context window and alert levels of that one chat in this tool's own settings file.</p>
    </div>
  </div>`;
}

// --- the app -----------------------------------------------------------------------------------------------------

function App() {
  const [snap, conn] = useSnapshot();
  const now = useNow(1000);
  const saved = useMemo(load, []);
  const [level, setLevel] = useState(saved.level ?? null);
  const [over, setOver] = useState({});                       // toggles that flip the level's flags until the level changes
  const [extra, setExtra] = useState({ arcPrompt: saved.arcPrompt ?? true, allSubagents: false, account: false });
  const [theme, setTheme] = useState(THEMES.some(([k]) => k === saved.theme) ? saved.theme : "auto");
  const [cur, setCur] = useState(null);
  const [locked, setLocked] = useState(false);
  const [open, setOpen] = useState({});
  const [query, setQuery] = useState("");
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState(null);
  const [asked, setAsked] = useState(false);
  const search = useRef(null);
  const toastTimer = useRef(null);

  const lvl = level ?? (snap ? snap.view.level : 75);
  const f = { ...flagsFor(lvl), ...over, ...extra };

  useEffect(() => { save({ level, theme, arcPrompt: extra.arcPrompt }); }, [level, theme, extra.arcPrompt]);
  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Archived chats are read by the data owner only when someone wants them: ask once when they are turned on here.
  useEffect(() => {
    if (snap && f.showArc && !snap.view.has_arc && !asked) {
      setAsked(true);
      postRefresh(true);
    }
  }, [snap, f.showArc, asked]);

  const say = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => { tell = say; }, [say]);
  const onCopied = useCallback(async (text, what) => {
    say((await copy(text)) ? `Copied the ${what}` : `Copy failed: select the text and press ⌘C`);
  }, [say]);

  const q = query.trim().toLowerCase();
  const match = (s) => !q || [s.label, s.title, s.folder, s.sid, s.model, s.running_in].some((v) => (v || "").toLowerCase().includes(q));
  const sessions = snap ? snap.sessions : [];
  const live = snap && snap.view.show_live ? sessions.filter((s) => s.active && match(s)) : [];
  const arc = f.showArc ? sessions.filter((s) => !s.active && match(s)) : [];
  const items = [...live, ...arc];
  const sids = items.map((s) => s.sid);

  useEffect(() => {                                           // keep the cursor on a chat that still exists
    if (!sids.length) { if (cur !== null) setCur(null); return; }
    if (!sids.includes(cur)) { setCur(sids[0]); setLocked(false); }
  }, [sids.join(",")]);

  useEffect(() => {
    if (!cur) return;
    const el = document.querySelector(`[data-sid="${cur}"]`);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [cur, locked]);

  const setLvl = (n) => { setLevel(Math.max(0, Math.min(100, n))); setOver({}); };
  const stepLvl = (d) => setLvl(LEVEL_REPS[Math.max(0, Math.min(4, viewIndex(lvl) + d))]);
  const flip = (k) => setOver((o) => ({ ...o, [k]: !f[k] }));
  const flipExtra = (k) => setExtra((e) => ({ ...e, [k]: !e[k] }));
  const refresh = () => { postRefresh(f.showArc); say("Refreshing…"); };
  const curS = items.find((s) => s.sid === cur);

  const pick = (sid) => {
    if (sid === cur && locked) return;
    setCur(sid);
    setLocked(true);
  };
  const move = (d) => {
    if (!sids.length) return;
    const i = sids.indexOf(cur);
    setCur(sids[Math.max(0, Math.min(sids.length - 1, (i < 0 ? 0 : i) + d))]);
  };

  // From the Machine band: show a chat (or the first of several ended ones) in the list and select it.
  const pending = useRef(null);
  const showChat = (sid) => {
    if (query) setQuery("");
    setCur(sid);
    setLocked(true);
  };
  const showEnded = (ids) => {
    if (query) setQuery("");
    const here = ids.find((id) => sids.includes(id));
    if (f.showArc && here) return showChat(here);
    pending.current = ids;                                    // the list is about to change: select one of these when it has
    if (!f.showArc) flip("showArc");
  };
  useEffect(() => {
    const hit = pending.current && sids.find((id) => pending.current.includes(id));
    if (hit) { pending.current = null; showChat(hit); }
  }, [sids.join(",")]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target && e.target.tagName;
      if (e.target && e.target.closest && e.target.closest(".editor")) { if (e.key === "Escape") e.target.blur(); return; }   // the window editor keeps its keys
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (typing) {
        if (e.key === "Escape") { setQuery(""); e.target.blur(); }
        else if (e.key === "Enter" || e.key === "ArrowDown") { e.target.blur(); }
        return;
      }
      if (help && e.key !== "?") { if (e.key === "Escape") setHelp(false); return; }
      const k = e.key;
      const act = {
        ArrowDown: () => move(1), ArrowUp: () => move(-1), j: () => move(1), k: () => move(-1),
        g: () => sids.length && setCur(sids[0]), G: () => sids.length && setCur(sids[sids.length - 1]),
        Enter: () => { if (!curS) return; if (!locked) setLocked(true); else onCopied(curS.resume, "resume command"); },
        y: () => curS && onCopied(curS.resume, "resume command"),
        i: () => curS && onCopied(curS.sid, "session id"),
        f: () => curS && onCopied(curS.clean, "fresh-chat command"),
        Escape: () => { if (locked) setLocked(false); else if (query) setQuery(""); },
        b: () => setLocked(false),
        "+": () => stepLvl(1), "=": () => stepLvl(1), "-": () => stepLvl(-1), _: () => stepLvl(-1),
        a: () => flip("showArc"), c: () => flip("compact"), p: () => flip("noPrompts"), v: () => flip("verbose"),
        s: () => flipExtra("allSubagents"), t: () => flipExtra("arcPrompt"), u: () => flipExtra("account"),
        e: () => setOpen((o) => (Object.keys(o).length ? {} : Object.fromEntries(sids.map((x) => [x, true])))),
        r: refresh, "/": () => search.current && search.current.focus(), "?": () => setHelp((h) => !h),
        d: () => setTheme((t) => { const n = nextTheme(t); say(`Theme: ${THEMES.find(([k]) => k === n)[1]}`); return n; }),
      };
      if ("12345".includes(k) && k.length === 1) { setLvl(LEVEL_REPS[+k - 1]); e.preventDefault(); return; }
      if (act[k]) { act[k](); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!snap) {
    return html`<div class="boot">
      ${conn === "stopped" ? html`<p><b>Can't reach the web server.</b></p><p class="dim">Start it again with <code>cust-codex-status --web</code>, or press <kbd>w</kbd> in the TUI. This page reconnects by itself.</p>`
        : html`<p>Connecting to cust-codex-status…</p>`}
    </div>`;
  }

  const t = snap.totals;
  const [r200, r1m] = [snap.view.ctx_rules["200k"], snap.view.ctx_rules["1m"]];
  const attn = attentionItems(snap);
  const vi = viewIndex(lvl);
  const age = now - snap.generated;
  let n = 0;
  const pickAndOpen = (sid) => pick(sid);
  const toggleOpen = (sid) => setOpen((o) => { const c = { ...o }; if (c[sid]) delete c[sid]; else c[sid] = true; return c; });

  return html`
    <header class="top">
      <div class="top-inner">
        <div class="brand"><img src="/static/favicon.svg" alt="" /><span>Codex Status</span><span class="pill" title="This page only reads Codex's data. The one thing it can change is the context window and alert levels of a single chat, saved in this tool's own settings file.">read-only data</span></div>
        <div class="serve" title="This page is served locally by cust-codex-status">
          <span class=${`dot dot-${conn}`}></span>
          <code>${location.host}</code>
          <span class="dim">${conn === "live" ? `${snap.source === "tui" ? "fed by the TUI" : "headless --web"} · updated ${since(age)} ago`
            : conn === "stopped" ? "server stopped · reconnecting when it is back" : "reconnecting…"}</span>
        </div>
        <div class="top-actions">
          <button class="btn btn-ghost" onClick=${refresh} title="Re-read now (r)">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3"/></svg><span class="btn-label">Refresh</span></button>
          <label class="theme" title="Switch theme (d cycles)">
            <span class="theme-l">Theme</span>
            <span class="theme-box">
              <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11A5.5 5.5 0 0 0 8 2.5z" fill="currentColor"/></svg>
              <select aria-label="Switch theme" value=${theme} onChange=${(e) => { setTheme(e.target.value); e.target.blur(); }}>
                <option disabled>Switch theme</option>
                ${THEMES.map(([k, label]) => html`<option value=${k}>${label}</option>`)}
              </select>
            </span>
          </label>
          <button class="btn btn-ghost btn-icon" onClick=${() => setHelp(true)} title="Keyboard shortcuts (?)">?</button>
        </div>
      </div>
      ${conn !== "live" ? html`<div class=${`banner banner-${conn}`}>${conn === "stopped"
        ? html`The web server stopped (the TUI quit, <kbd>W</kbd> was pressed, or no browser was open for a minute). Showing the last data. Start it again with <code>cust-codex-status --web</code> or <kbd>w</kbd> in the TUI.`
        : "Connection lost, retrying…"}</div>` : ""}
    </header>

    <main class="wrap">
      <section class="summary">
        <div class="who">
          <b>${snap.account.email || "?"}</b>
          <span class="dim">${snap.account.plan || "?"} · ${snap.account.tier || "?"}</span>
          <button class="btn btn-link" onClick=${() => flipExtra("account")}>${extra.account ? "hide account" : "account details"}</button>
        </div>
        <div class="totals">
          <span><b>${t.live}</b> live</span><span><b>${t.mem_mb}</b>MB</span><span><b>${fmtTok(t.live_tokens)}</b> live tokens</span>
          ${f.showArc ? html`<span><b>${t.archived}</b> archived · ${fmtTok(t.arc_tokens)}</span>` : ""}
        </div>
        <div class="health-counts" title="health of live chats">
          ${["OK", "AMBER", "RED"].map((k) => html`<span><${Badge} level=${k} /> ${t.health[k]}</span>`)}
        </div>
        <div class="clock dim">${snap.clock}</div>
        ${extra.account ? html`<dl class="account">${snap.account.fields.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>` : ""}
      </section>

      ${f.minimal ? "" : html`<${MachineBand} system=${snap.system || []} onPick=${showChat} onShowEnded=${showEnded} />`}

      ${f.minimal ? "" : html`<${Panel} title="Usage limits"><${Usage} u=${snap.usage} /><//>`}
      ${!f.minimal && attn.length ? html`<${Attention} items=${attn} onCopied=${onCopied} />` : ""}

      <div class="toolbar" role="toolbar" aria-label="View">
        <div class="seg" role="radiogroup" aria-label="View level">
          ${VIEWS.map((v, i) => html`<button role="radio" aria-checked=${vi === i} class=${vi === i ? "on" : ""}
            onClick=${() => setLvl(LEVEL_REPS[i])} title=${`${v} view (${i + 1})`}>${v}</button>`)}
        </div>
        <div class="toggles">
          ${[["showArc", "Archived", "a"], ["compact", "Compact rows", "c"], ["noPrompts", "Prompts", "p", true], ["verbose", "Subagents", "v"]].map(([k, label, key, inv]) =>
            html`<button class=${`chip ${(inv ? !f[k] : f[k]) ? "on" : ""}`} aria-pressed=${inv ? !f[k] : f[k]} onClick=${() => flip(k)} title=${`${label} on/off (${key})`}>${label}</button>`)}
          ${f.showArc ? html`<button class=${`chip ${extra.arcPrompt ? "on" : ""}`} aria-pressed=${extra.arcPrompt} onClick=${() => flipExtra("arcPrompt")} title="Archived prompt line on/off (t)">Archived prompts</button>` : ""}
        </div>
        <label class="search">
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
          <input ref=${search} type="search" placeholder="Filter chats" value=${query} onInput=${(e) => setQuery(e.target.value)} aria-label="Filter chats" />
          ${query ? "" : html`<kbd>/</kbd>`}
        </label>
      </div>

      ${f.minimal ? "" : html`<p class="legend">
        <${Badge} level="OK" /> nothing to do <${Badge} level="AMBER" /> context ≥${r200[0]}% (200k) / ≥${r1m[0]}% (1M), waiting on a prompt, memory, or idle >1h
        <${Badge} level="RED" /> context ≥${r200[1]}% / ≥${r1m[1]}%</p>`}

      ${snap.view.show_live ? html`<${Panel} title="Live sessions" right=${f.compact ? (f.minimal ? "minimal" : "compact") : "a process is running; idle ones still hold memory"}>
        ${live.length === 0 ? html`<p class="empty">${q ? "No live chat matches the filter." : "None running."}</p>`
          : f.compact ? html`<div class="rows">${live.map((s) => html`<${Row} key=${s.sid} s=${s} n=${++n} f=${f} nav=${cur === s.sid && !locked} sel=${cur === s.sid && locked}
              open=${!!open[s.sid]} onPick=${pickAndOpen} onToggle=${toggleOpen} onCopied=${onCopied} />`)}</div>`
          : html`<div class="cards">${live.map((s) => html`<${Card} key=${s.sid} s=${s} n=${++n} f=${f} nav=${cur === s.sid && !locked} sel=${cur === s.sid && locked}
              onPick=${pickAndOpen} onCopied=${onCopied} />`)}</div>`}
      <//>` : ""}

      ${f.showArc ? html`<${Panel} title="Archived / ended" tone="muted" right=${snap.view.has_arc ? `last ${snap.view.days}d · newest ${arc.length} shown` : "loading…"}>
        ${!snap.view.has_arc ? html`<p class="empty">Reading archived chats…</p>`
          : arc.length === 0 ? html`<p class="empty">${q ? "No archived chat matches the filter." : `None in the last ${snap.view.days}d.`}</p>`
          : html`<div class="rows">${arc.map((s) => html`<${Row} key=${s.sid} s=${s} n=${++n} f=${f} archived nav=${cur === s.sid && !locked} sel=${cur === s.sid && locked}
              open=${!!open[s.sid]} onPick=${pickAndOpen} onToggle=${toggleOpen} onCopied=${onCopied} />`)}</div>`}
        ${snap.view.hidden ? html`<p class="note">${snap.view.hidden} older archived chat(s) not shown: start with -n 0 for all, -n N for more, -d DAYS to widen.</p>` : ""}
      <//>` : ""}

      <p class="foot-note dim">ctx = last turn's input+cache vs the window (~ = may be a 1M window) · * = waiting on a permission prompt ·
        the same data as the terminal view, served from this machine only</p>
    </main>

    <footer class="keybar">
      <span class=${`mode ${locked ? "mode-sel" : "mode-nav"}`}>${locked ? "SELECTED" : "NAVIGATE"}</span>
      <span class="keybar-info">${locked && curS ? html`<b>#${sids.indexOf(cur) + 1} ${curS.label}</b>
          <button class="btn btn-xs" onClick=${() => onCopied(curS.resume, "resume command")}>Copy resume <kbd>⏎</kbd></button>
          <button class="btn btn-xs btn-ghost" onClick=${() => onCopied(curS.sid, "session id")}>Copy id <kbd>i</kbd></button>
          <button class="btn btn-xs btn-ghost" onClick=${() => onCopied(curS.clean, "fresh-chat command")}>Copy fresh <kbd>f</kbd></button>
          <button class="btn btn-xs btn-back" onClick=${() => setLocked(false)}>◂ Back <kbd>Esc</kbd></button>`
        : KEYS_SHORT.map(([k, d]) => html`<span class="hint"><${Key} k=${k} /> ${d}</span>`)}</span>
      <span class="dim keybar-view">view: ${VIEWS[vi]} (level ${lvl})</span>
    </footer>

    ${help ? html`<${Help} onClose=${() => setHelp(false)} />` : ""}
    ${toast ? html`<div class="toast" role="status">${toast}</div>` : ""}
  `;
}

const root = document.getElementById("app");
root.textContent = "";                                        // drop the static "Connecting…" placeholder
render(html`<${App} />`, root);
