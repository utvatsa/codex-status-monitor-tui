"""Everything read from disk or `ps`: live chats, rollouts, subagents, account and the latest usage limits. Read-only.

Sources (all under ~/.codex, or $CODEX_HOME): sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl and archived_sessions/ (the chat
transcripts), session_index.jsonl (chat names), state_5.sqlite (threads + spawn edges, opened read-only and optional), config.toml,
models_cache.json and auth.json (only the non-secret claims of the id token are read). Nothing is ever written."""
import base64
import datetime as dt
import glob
import json
import os
import re
import shutil
import sqlite3
import subprocess
import time

from . import config
from .config import by_prefix, ARCHIVE_DEFAULT, CODEX, DEFAULT_WINDOWS, ENTRY_LABEL, HOME, HOSTS, RUNNING_SECS, WINDOW_GUESS, window_overrides
from .util import home_rel, iso_ts


def _load(path):
    with open(path) as f:
        return json.load(f)


def ps_table():
    out = subprocess.run(["ps", "-axo", "pid=,ppid=,rss=,pcpu=,etime=,comm="], capture_output=True, text=True).stdout
    rows = {}
    for line in out.splitlines():
        p = line.split(None, 5)
        if len(p) < 6:
            continue
        try:
            rows[int(p[0])] = dict(ppid=int(p[1]), rss=int(p[2]), cpu=float(p[3]), etime=p[4], comm=os.path.basename(p[5]), path=p[5])
        except ValueError:
            continue
    try:                                                   # full command lines, to tell `app-server`, `exec` and `resume <id>` apart
        out = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True).stdout
        for line in out.splitlines():
            p = line.strip().split(None, 1)
            if len(p) == 2 and p[0].isdigit() and int(p[0]) in rows:
                rows[int(p[0])]["args"] = p[1]
    except OSError:
        pass
    return rows


def etime_secs(et):
    days, _, rest = et.rpartition("-")
    parts = [int(x) for x in rest.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    return int(days or 0) * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2]


def descendants(pid, table):
    kids = {}
    for p, r in table.items():
        kids.setdefault(r["ppid"], []).append(p)
    out, stack = [], [pid]
    while stack:
        for k in kids.get(stack.pop(), []):
            out.append(k)
            stack.append(k)
    return out


def host_of(pid, table):
    for _ in range(12):
        if pid not in table:
            break
        c = table[pid]["comm"].lstrip("-")
        for k, v in HOSTS.items():
            if c.startswith(k):
                return v
        if c in ("zsh", "bash", "fish"):
            return "terminal"
        pid = table[pid]["ppid"]
    return None


# ---- codex processes ------------------------------------------------------------------------------------------------------------------

def proc_cwd(pid):
    """Working folder of a process (macOS lsof), or None."""
    try:
        out = subprocess.run(["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"], capture_output=True, text=True, timeout=3).stdout
    except Exception:
        return None
    for line in out.splitlines():
        if line.startswith("n"):
            return line[1:]
    return None


def codex_procs(table):
    """Running Codex hosts: [dict(pid, kind, host, entry, args)]. kind: app-server (one process serves many chats: the desktop app, the VS Code
    extension) | cli | exec | acp (one process per chat)."""
    found = []
    for pid, r in table.items():
        comm, path = r["comm"], r.get("path", "")
        args = r.get("args") or path
        rest = args.split(None, 1)[1] if " " in args else ""
        if comm.startswith("codex-acp"):
            found.append(dict(pid=pid, kind="acp", entry="acp", host=host_of(r["ppid"], table) or "JetBrains", args=args))
        elif comm == "codex":
            if re.search(r"(^|\s)app-server(\s|$)", rest):
                host = "Desktop" if "/ChatGPT.app/" in path or "/Codex.app/" in path else "VS Code" if ".vscode" in path or "openai.chatgpt" in path else host_of(r["ppid"], table)
                found.append(dict(pid=pid, kind="app-server", entry="desktop" if host == "Desktop" else "vscode" if host == "VS Code" else "appserver",
                                  host=host or "app-server", args=args))
            elif re.search(r"(^|\s)exec(\s|$)", rest):
                found.append(dict(pid=pid, kind="exec", entry="exec", host=host_of(r["ppid"], table) or "terminal", args=args))
            else:
                found.append(dict(pid=pid, kind="cli", entry="cli", host=host_of(r["ppid"], table) or "terminal", args=args))
    pids = {f["pid"] for f in found}
    return [f for f in found if table[f["pid"]]["ppid"] not in pids]       # a helper of a codex process is not another chat


def proc_info(p, table):
    r = table[p["pid"]]
    group = [p["pid"]] + descendants(p["pid"], table)
    return dict(pid=p["pid"], cpu=r["cpu"], up=r["etime"], started=time.time() - etime_secs(r["etime"]), host=p["host"],
                mem_mb=sum(table[x]["rss"] for x in group if x in table) // 1024)


# ---- rollout files -------------------------------------------------------------------------------------------------------------------

UUID = re.compile(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$")
HEAD = re.compile(r'"type":"(\w+)","payload":\{"type":"(\w+)"')
CALL_ID = re.compile(r'"call_id":"([^"]+)"')
TS = re.compile(r'"timestamp":"([^"]+)"')


def sid_of(path):
    m = UUID.search(path)
    return m.group(1) if m else os.path.basename(path)[:-6]


def _obj(line):
    """json.loads that only accepts a JSON object (a bare string or number on a line is skipped like any other bad line)."""
    d = json.loads(line)
    if not isinstance(d, dict):
        raise TypeError("not an object")
    return d


def rollout_files():
    """[(path, mtime, in archived_sessions/)] for every rollout on disk."""
    out = []
    for pattern, arc in ((f"{CODEX}/sessions/*/*/*/rollout-*.jsonl", False), (f"{CODEX}/archived_sessions/rollout-*.jsonl", True)):
        for p in glob.glob(pattern):
            try:
                out.append((p, os.path.getmtime(p), arc))
            except OSError:
                pass
    return out


_meta_cache = {}


def head_meta(path):
    """session_meta payload (first line of a rollout): id, cwd, originator, source, cli_version. Cached; {} when unreadable."""
    if path in _meta_cache:
        return _meta_cache[path]
    meta = {}
    try:
        with open(path, errors="ignore") as f:
            d = _obj(f.readline())
            if d.get("type") == "session_meta":
                meta = {k: v for k, v in (d.get("payload") or {}).items() if k != "base_instructions"}
    except (OSError, ValueError, TypeError):
        pass
    if meta:
        _meta_cache[path] = meta
    return meta


def entry_of(source, originator=None):
    """Where a chat was started: cli | exec | desktop | vscode | acp | appserver, from session_meta.source and .originator."""
    s, o = (source if isinstance(source, str) else "") or "", (originator or "").lower()
    if "acp" in o or "jetbrains" in o or "acp" in s.lower():
        return "acp"
    if s == "exec" or "exec" in o:
        return "exec"
    if s == "cli" or o.startswith("codex_cli") or o == "codex-tui":
        return "cli"
    if "desktop" in o or "chatgpt" in o:
        return "desktop"
    if s == "vscode" or "vscode" in o or "vs code" in o:
        return "vscode"
    return s or None


def is_subagent_source(source):
    return isinstance(source, dict) and "subagent" in source


def parent_of(source):
    try:
        return source["subagent"]["thread_spawn"]["parent_thread_id"]
    except (KeyError, TypeError):
        return None


def prompt_text(text):
    """A user prompt as one line of plain text; empty for the wrapper blocks Codex injects (environment context, instructions)."""
    if not isinstance(text, str):
        return ""
    t = text.strip()
    if t.startswith("<"):
        return ""
    return " ".join(t.split())


def sum_tokens(usage, turns=0):
    """token_count.info.total_token_usage -> totals. Codex counts cached tokens inside input_tokens; `input` here is the uncached part."""
    u = usage or {}
    cached = u.get("cached_input_tokens", 0) or 0
    return dict(input=max(0, (u.get("input_tokens", 0) or 0) - cached), output=u.get("output_tokens", 0) or 0, cache_read=cached,
                cache_write=u.get("cache_write_input_tokens", 0) or 0, reasoning=u.get("reasoning_output_tokens", 0) or 0, turns=turns)


def scan(path):
    """Single pass over one rollout -> totals, last-turn context size, model, prompts, open-turn and pending-tool-call state."""
    r = dict(entry=None, cwd=None, model=None, ctx=0, first=None, last_prompt=None, effort=None, models={}, first_prompt=None, last_ts=None,
             window=None, open=False, waiting=None, waiting_since=None, approval=None, source=None, originator=None, version=None)
    usage, turns, pending, appr = None, 0, {}, None
    with open(path, errors="ignore") as f:
        for line in f:
            m = HEAD.search(line, 0, 220)
            head = line[:140]
            if not m and '"type":"session_meta"' not in head and '"type":"turn_context"' not in head:
                continue
            kind, sub = (m.group(1), m.group(2)) if m else (None, None)
            ts = TS.search(line, 0, 80)
            if ts:
                r["last_ts"] = ts.group(1)
            if kind is None:                                     # session_meta / turn_context (their payload has no "type")
                try:
                    d = _obj(line)
                except (ValueError, TypeError):
                    continue
                p = d.get("payload") or {}
                if d.get("type") == "session_meta":
                    r["cwd"], r["source"], r["originator"], r["version"] = p.get("cwd"), p.get("source"), p.get("originator"), p.get("cli_version")
                    r["first"] = p.get("timestamp") or d.get("timestamp")
                else:
                    r["model"] = p.get("model") or r["model"]
                    r["effort"] = p.get("effort") or r["effort"]
                    r["cwd"] = p.get("cwd") or r["cwd"]
                    r["approval"] = p.get("approval_policy") or r["approval"]
                    if p.get("model"):
                        r["models"][p["model"]] = r["models"].get(p["model"], 0) + 1
                continue
            if kind == "event_msg":
                if sub == "token_count":
                    try:
                        p = _obj(line)["payload"]
                    except (ValueError, TypeError, KeyError):
                        continue
                    info = p.get("info") or {}
                    if info.get("total_token_usage"):
                        usage = info["total_token_usage"]
                        r["ctx"] = (info.get("last_token_usage") or {}).get("input_tokens", r["ctx"]) or 0
                    r["window"] = info.get("model_context_window") or r["window"]
                elif sub == "task_started":
                    turns += 1
                    r["open"] = True
                elif sub in ("task_complete", "turn_aborted"):
                    r["open"] = False
                    pending.clear()
                    appr = None
                elif sub == "user_message":
                    try:
                        t = prompt_text(_obj(line)["payload"].get("message"))
                    except (ValueError, TypeError, KeyError):
                        continue
                    if t:
                        r["first_prompt"] = r["first_prompt"] or t
                        r["last_prompt"] = t
                elif sub == "item_completed" and '"UserMessage"' in line[:600]:        # the desktop app records prompts as items
                    try:
                        item = _obj(line)["payload"]["item"]
                        text = " ".join(c.get("text", "") for c in item.get("content", []) if isinstance(c, dict))
                    except (ValueError, TypeError, KeyError, AttributeError):
                        continue
                    t = prompt_text(text.split("## My request:", 1)[-1])
                    if t:
                        r["first_prompt"] = r["first_prompt"] or t
                        r["last_prompt"] = t
                elif "approval_request" in sub:
                    appr = (sub.replace("_approval_request", "").replace("_", " "), r["last_ts"])
            elif kind == "response_item":
                if sub in ("function_call", "custom_tool_call", "local_shell_call"):
                    cid = CALL_ID.search(line, 0, 700)
                    name = re.search(r'"name":"([^"]+)"', line[:1000])
                    pending[cid.group(1) if cid else "n%d" % len(pending)] = (name.group(1) if name else sub, r["last_ts"] or "")
                    appr = None
                elif sub.endswith("_output"):
                    cid = CALL_ID.search(line, 0, 700)
                    pending.pop(cid.group(1) if cid else None, None)
                    appr = None
    if r["open"] and appr:
        r["waiting"], r["waiting_since"] = appr[0], iso_ts(appr[1])
    elif r["open"] and pending and r["approval"] != "never":
        name, t = min(pending.values(), key=lambda v: v[1])
        r["waiting"], r["waiting_since"] = f"tool call: {name}", iso_ts(t)
    r["entry"] = entry_of(r["source"], r["originator"])
    r["tokens"] = sum_tokens(usage, turns)
    return r


QUIET_DONE_SECS = 600        # an older subagent (no explicit status) quiet this long is assumed to be done


def subagent_phase(finished, age, parent_live):
    """active | idle | done | closed. `finished` is the spawn edge's status turned into a flag (True when closed, False when open, None when
    unknown). Written to recently = active; finished = done; an older subagent without a status that has been quiet for a while is assumed
    done; one that never finished while its chat has ended is closed; anything else is alive but quiet: idle (waiting or stalled)."""
    if finished is True:
        return "done"
    if age < RUNNING_SECS:
        return "active"
    if finished is None and age > QUIET_DONE_SECS:
        return "done"
    return "idle" if parent_live else "closed"


# ---- sqlite + index ---------------------------------------------------------------------------------------------------------------

THREAD_COLS = ("id", "rollout_path", "cwd", "title", "name", "source", "model", "reasoning_effort", "archived", "git_branch", "cli_version",
               "agent_nickname", "agent_role", "agent_path", "originator", "updated_at_ms", "tokens_used", "first_user_message")


def threads_db():
    """-> (threads {id: row dict}, edges {parent id: [(child id, status)]}) from state_*.sqlite, read-only. ({}, {}) when missing, locked or
    changed beyond recognition: every field it gives is also derived from the rollouts."""
    threads, edges = {}, {}
    paths = sorted(glob.glob(f"{CODEX}/state_*.sqlite"), key=lambda p: [int(x) for x in re.findall(r"\d+", os.path.basename(p))] or [0])
    if not paths:
        return threads, edges
    try:
        con = sqlite3.connect(f"file:{paths[-1]}?mode=ro", uri=True, timeout=1.5)
        try:
            cols = [c[1] for c in con.execute("PRAGMA table_info(threads)")]
            pick = [c for c in THREAD_COLS if c in cols]
            if "id" in pick:
                for row in con.execute(f"SELECT {','.join(pick)} FROM threads"):
                    d = dict(zip(pick, row))
                    threads[d["id"]] = d
            try:
                for parent, child, status in con.execute("SELECT parent_thread_id, child_thread_id, status FROM thread_spawn_edges"):
                    edges.setdefault(parent, []).append((child, status))
            except sqlite3.Error:
                pass
        finally:
            con.close()
    except (sqlite3.Error, ValueError, OSError):
        return {}, {}
    return threads, edges


def session_index():
    """id -> thread_name (the newest entry per id wins)."""
    names, stamp = {}, {}
    try:
        with open(f"{CODEX}/session_index.jsonl", errors="ignore") as f:
            for line in f:
                try:
                    d = _obj(line)
                except (ValueError, TypeError):
                    continue
                if d.get("id") and d.get("thread_name") and (d.get("updated_at") or "") >= stamp.get(d["id"], ""):
                    names[d["id"]], stamp[d["id"]] = d["thread_name"], d.get("updated_at") or ""
    except OSError:
        pass
    return names


def subagents(children, files, db, live=True):
    """children: [(child id, edge status)]; files: id -> (path, mtime)."""
    out = []
    for cid, status in children:
        path = (files.get(cid) or (None,))[0]
        row = db.get(cid) or {}
        if not path and row.get("rollout_path") and os.path.exists(row["rollout_path"]):
            path = row["rollout_path"]
        if not path:
            continue
        try:
            s, m = scan(path), os.path.getmtime(path)
        except OSError:
            continue
        fin = True if status in ("closed", "completed", "done", "shutdown") else False if status in ("open", "running") else None
        name = row.get("agent_nickname") or (row.get("agent_path") or "").rsplit("/", 1)[-1]
        out.append(dict(id=cid, type=row.get("agent_role") or "agent", desc=" · ".join(x for x in (name, row.get("title") or "") if x),
                        model=s["model"] or row.get("model"), tokens=s["tokens"], ctx=s["ctx"], mtime=m,
                        state="running" if time.time() - m < RUNNING_SECS else "done",
                        phase=subagent_phase(fin, time.time() - m, live)))
    out.sort(key=lambda a: -a["mtime"])
    return out


# ---- configuration: models, windows, defaults ---------------------------------------------------------------------------------------

def toml_top(key):
    """A top-level string value from ~/.codex/config.toml (no TOML parser on Python 3.9)."""
    try:
        with open(f"{CODEX}/config.toml", errors="ignore") as f:
            for line in f:
                if line.lstrip().startswith("["):
                    break
                m = re.match(rf'\s*{re.escape(key)}\s*=\s*"([^"]*)"', line)
                if m:
                    return m.group(1)
    except OSError:
        pass
    return None


def model_windows():
    """model slug -> context window, from models_cache.json."""
    try:
        return {m["slug"]: int(m["context_window"]) for m in _load(f"{CODEX}/models_cache.json").get("models", []) if m.get("slug") and m.get("context_window")}
    except (OSError, ValueError, AttributeError, TypeError, KeyError):
        return {}


def window_for(model, ctx, sid=None, reported=None):
    """-> (window tokens, source). What the user set for this chat, a model override in the config, the window the rollout reported
    (token_count.model_context_window), models_cache.json, the built-in table, the context itself when it is already above the guess, and
    only then WINDOW_GUESS."""
    over, m = window_overrides(), model or ""
    mine = by_prefix(over, sid) if sid else None
    if mine:
        return mine, "chat"
    hit = max((k for k in over if k in m), key=len, default=None)
    if hit:
        return over[hit], "config"
    if reported:
        return int(reported), "reported"
    cache = model_windows()
    if m in cache:
        return cache[m], "default"
    hit = max((k for k in DEFAULT_WINDOWS if k in m), key=len, default=None)
    if hit:
        return DEFAULT_WINDOWS[hit], "default"
    if ctx > WINDOW_GUESS:
        return 1_000_000, "evidence"
    return WINDOW_GUESS, "guess"


# ---- rows ------------------------------------------------------------------------------------------------------------------------

def row_for(path, lv, archived, mtime, with_subs, db=None, names=None, kids=None, files=None, s=None):
    s = s or scan(path)
    db, names, kids, files = db or {}, names or {}, kids or {}, files or {}
    sid = sid_of(path)
    t = db.get(sid) or {}
    entry = (lv or {}).get("entry") or s["entry"] or entry_of(t.get("source"), t.get("originator"))
    model = s["model"] or t.get("model") or toml_top("model")
    window, window_source = window_for(model, s["ctx"], sid, s["window"])
    title = " ".join((names.get(sid) or t.get("name") or t.get("title") or s["first_prompt"] or "").split())[:80] or "(untitled)"
    state = ("busy" if s["open"] else "idle") if lv else ("running?" if time.time() - mtime < RUNNING_SECS else "ended")
    last_run = iso_ts(s["last_ts"]) or mtime
    waiting = s["waiting"] if lv else None
    if waiting and waiting.startswith("tool call") and s["waiting_since"] and time.time() - s["waiting_since"] < config.alert_rules()["time"]["waiting_secs"]:
        waiting = None                                 # an unanswered tool call is only "waiting on you" after a short grace period
    return dict(transcript=path, window_source=window_source, status_since=(s["waiting_since"] or last_run) if lv else None,
                host=(lv or {}).get("host"), session_id=sid, active=bool(lv), archived_by_ide=sid in archived,
                name=(lv or {}).get("name"), title=title, source=ENTRY_LABEL.get(entry) or (lv or {}).get("host") or entry or "?", entry=entry,
                state=state, waiting=waiting, pid=(lv or {}).get("pid"), mem_mb=(lv or {}).get("mem_mb"), cpu=(lv or {}).get("cpu"),
                up=(lv or {}).get("up"), version=s["version"] or t.get("cli_version"), model=model,
                effort=s["effort"] or t.get("reasoning_effort") or toml_top("model_reasoning_effort"),
                models=s["models"], ctx=s["ctx"], window=window, tokens=s["tokens"], cost=None, cwd=home_rel(s["cwd"] or t.get("cwd") or ""),
                last_active=mtime, first_prompt=s["first_prompt"] or t.get("first_user_message") or None,
                latest_prompt=s["last_prompt"] or s["first_prompt"], last_run=last_run, branch=t.get("git_branch"),
                subagents=subagents(kids.get(sid, []), files, db, bool(lv)) if with_subs else [])


def live_chats(procs, table, cands, metas, now=None):
    """Which rollouts are live right now: {session id: lv dict}. `cands`: [(path, mtime, scan)] of recent rollouts, `metas`: path -> session_meta.

    A shared app-server (desktop app, VS Code) serves many chats, so a chat counts as live while the server runs and the chat wrote within
    live_idle_min (or has a turn open); its memory cannot be split per chat, so mem_mb is None. A per-chat process (cli, exec, acp) is matched
    to its rollout by `resume <id>` in its command line, else by folder and start time; one without a rollout yet shows as a new chat."""
    now = now or time.time()
    live, taken = {}, set()
    idle_secs = config.alert_rules()["time"]["live_idle_min"] * 60
    servers = {p["entry"]: p for p in procs if p["kind"] == "app-server"}
    for path, mtime, sc in cands:
        ent = sc["entry"]
        srv = servers.get(ent) or (servers.get("appserver") if ent in ("desktop", "vscode") else None)
        if srv and (now - mtime < idle_secs or (sc["open"] and now - mtime < 7200)):
            live[sid_of(path)] = dict(proc_info(srv, table), entry=ent, shared=True, mem_mb=None)
    for p in sorted((p for p in procs if p["kind"] != "app-server"), key=lambda p: p["pid"]):
        info = dict(proc_info(p, table), entry=p["entry"])
        m = re.search(r"\bresume\s+(?:-\S+\s+)*([0-9a-f]{8}-[0-9a-f-]{27})", p["args"] or "")
        sid = m.group(1) if m else None
        if not sid:
            cwd = proc_cwd(p["pid"])
            best = None
            for path, mtime, sc in cands:
                if sid_of(path) in taken or sc["entry"] in ("desktop", "vscode") or mtime < info["started"] - 120:
                    continue
                if cwd and (metas.get(path) or {}).get("cwd") != cwd:
                    continue
                if best is None or mtime > best[1]:
                    best = (sid_of(path), mtime)
            sid = best[0] if best else "proc-%d" % p["pid"]
        taken.add(sid)
        live[sid] = info
    return live


def collect(days=7, project=None, show_live=True, show_arc=False, limit=None):
    """-> (rows, hidden). Live chats first, then archived newest first; `hidden` = archived rows cut by `limit` (None = default cap, 0 = no cap)."""
    table = ps_table()
    procs = codex_procs(table)
    db, edges = threads_db()
    names = session_index()
    archived = {i for i, t in db.items() if t.get("archived")}
    files, metas, spawned = {}, {}, {}
    allfiles = rollout_files()
    for path, mtime, arc in allfiles:
        sid = sid_of(path)
        files[sid] = (path, mtime)
        metas[path] = head_meta(path)
        if arc:
            archived.add(sid)
        par = parent_of(metas[path].get("source"))
        if par:
            spawned.setdefault(par, {})[sid] = None
    for par, ch in edges.items():
        for cid, st in ch:
            spawned.setdefault(par, {})[cid] = st
    kids = {par: list(ch.items()) for par, ch in spawned.items()}
    now = time.time()
    cutoff = now - days * 86400
    chats = [(p, m) for p, m, _ in allfiles if not is_subagent_source((metas.get(p) or {}).get("source"))]
    scans, cands = {}, []
    if procs:
        for p, m in chats:
            if now - m < 7200:
                try:
                    scans[p] = scan(p)
                    cands.append((p, m, scans[p]))
                except OSError:
                    pass
    live = live_chats(procs, table, cands, metas, now) if procs else {}

    def match(path):
        return not project or project.lower() in (path + " " + ((metas.get(path) or {}).get("cwd") or "")).lower()
    live_paths, arc_paths = [], []
    for path, mtime in chats:
        if not match(path):
            continue
        if sid_of(path) in live:
            live_paths.append((path, mtime))
        elif mtime >= cutoff:
            arc_paths.append((path, mtime))
    rows = []
    if show_live:
        for path, mtime in live_paths:
            rows.append(row_for(path, live[sid_of(path)], archived, mtime, True, db, names, kids, files, scans.get(path)))
        seen = {r["session_id"] for r in rows}
        for sid, lv in live.items():
            if sid not in seen and not lv.get("shared") and (not project or project.lower() in (lv["host"] or "").lower()):
                model = toml_top("model")
                rows.append(dict(host=lv["host"], session_id=sid, active=True, archived_by_ide=False, name=None, title="(new chat)",
                                 source=ENTRY_LABEL.get(lv["entry"]) or lv["host"] or lv["entry"], entry=lv["entry"], state="idle", waiting=None,
                                 pid=lv["pid"], mem_mb=lv["mem_mb"], cpu=lv["cpu"], up=lv["up"], version=None, model=model,
                                 effort=toml_top("model_reasoning_effort"), models={}, ctx=0, window=window_for(model, 0)[0], window_source="guess",
                                 transcript=None, status_since=lv["started"], cost=None, cwd="", last_active=lv["started"], subagents=[],
                                 tokens=dict(input=0, output=0, cache_read=0, cache_write=0, reasoning=0, turns=0),
                                 first_prompt=None, latest_prompt=None, last_run=lv["started"], branch=None))
    hidden = 0
    if show_arc:
        arc_paths.sort(key=lambda x: -x[1])
        cap = ARCHIVE_DEFAULT if limit is None else limit          # -n 0 = no limit; -n 50 raises the cap
        shown = arc_paths[:cap] if cap else arc_paths
        hidden = len(arc_paths) - len(shown)
        for path, mtime in shown:
            r = row_for(path, None, archived, mtime, True, db, names, kids, files)
            if r["tokens"]["turns"]:
                rows.append(r)
    rows.sort(key=lambda r: (not r["active"], -r["last_active"]))
    return rows, hidden


# ---- account and usage limits ------------------------------------------------------------------------------------------------------

def jwt_claims(token):
    """Payload of a JWT, decoded without verifying. Only claims are returned, never the token."""
    try:
        p = token.split(".")[1]
        d = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def window_label(minutes):
    """5-hour / weekly style label from a window length in minutes."""
    m = int(minutes or 0)
    if m == 300:
        return "5-hour session"
    if m == 10080:
        return "weekly"
    if m and m % 1440 == 0:
        return f"{m // 1440}-day"
    if m and m % 60 == 0:
        return f"{m // 60}-hour"
    return f"{m}-minute" if m else "limit"


def latest_limits(max_files=12):
    """Newest rate_limits seen in any rollout -> (limits list, fetched-at ms, plan type, credits). Reads only the tail of the newest files."""
    best = None
    for path, mtime, _ in sorted(rollout_files(), key=lambda x: -x[1])[:max_files]:
        if best and best[1] >= mtime:
            break
        try:
            with open(path, "rb") as f:
                f.seek(0, os.SEEK_END)
                f.seek(max(0, f.tell() - 400_000))
                tail = f.read().decode("utf-8", "ignore").splitlines()
        except OSError:
            continue
        for line in reversed(tail):
            if '"rate_limits"' not in line or '"token_count"' not in line[:300]:
                continue
            try:
                d = _obj(line)
                rl = d["payload"]["rate_limits"]
            except (ValueError, TypeError, KeyError):
                continue
            if isinstance(rl, dict) and (rl.get("primary") or rl.get("secondary")):
                ts = iso_ts(d.get("timestamp")) or mtime
                if best is None or ts > best[1]:
                    best = (rl, ts)
                break
    if not best:
        return [], None, None, {}
    rl, ts = best
    limits = []
    scope = rl.get("limit_name") or (rl.get("limit_id") if rl.get("limit_id") not in (None, "codex") else None)
    for key in ("primary", "secondary"):
        w = rl.get(key)
        if not isinstance(w, dict):
            continue
        mins, reset, raw = w.get("window_minutes"), w.get("resets_at"), w.get("used_percent") or 0
        passed = bool(reset) and reset < time.time()
        label = window_label(mins)
        limits.append(dict(kind="session" if mins == 300 else "weekly_all" if mins == 10080 else f"window_{mins}", label=label,
                           percent=0 if passed else round(raw), is_active=False, window_minutes=mins, reset_passed=passed,
                           resets_at=dt.datetime.fromtimestamp(reset, dt.timezone.utc).isoformat() if reset else None,
                           scope={"model": {"display_name": scope}} if scope else None))
    if limits:
        max(limits, key=lambda l: l["percent"])["is_active"] = True
    return limits, int(ts * 1000), rl.get("plan_type"), rl.get("credits") or {}


def account():
    """-> (account dict, usage dict). usage mirrors the shape the renderer and the web view read: {"utilization": {"limits": [...]}, "fetchedAtMs": ms}."""
    try:
        auth = _load(f"{CODEX}/auth.json")
    except (OSError, ValueError):
        auth = {}
    auth = auth if isinstance(auth, dict) else {}
    tokens = auth.get("tokens") if isinstance(auth.get("tokens"), dict) else {}
    claims = jwt_claims(tokens.get("id_token") or "")
    oa = claims.get("https://api.openai.com/auth") if isinstance(claims.get("https://api.openai.com/auth"), dict) else {}
    limits, fetched, plan_type, credits = latest_limits()
    orgs = oa.get("organizations") if isinstance(oa.get("organizations"), list) else []
    org = next((o.get("title") for o in orgs if isinstance(o, dict) and o.get("is_default")), None)
    acct = {}
    if auth or limits:
        acct = dict(name=claims.get("name"), email=claims.get("email"), plan=oa.get("chatgpt_plan_type") or plan_type,
                    tier=auth.get("auth_mode"), role=None, org=org, billing=auth.get("auth_mode"), extra=bool(credits.get("has_credits")),
                    since=oa.get("chatgpt_subscription_active_start"), default_model=toml_top("model"), cli=_cli_version())
    return acct, (dict(utilization=dict(limits=limits), fetchedAtMs=fetched) if limits else {})


def _cli_version():
    for exe in (shutil.which("codex"), "/Applications/ChatGPT.app/Contents/Resources/codex"):
        if exe and os.path.exists(exe):
            try:
                out = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=5).stdout.strip()
                if out:
                    return out
            except Exception:
                pass
    return None
