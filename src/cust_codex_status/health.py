"""The rules that decide whether a chat needs attention (OK / AMBER / RED), and the tips that follow from them.

The numbers live in config.DEFAULT_RULES (the user overrides them in the config file); the rules that use them live here."""
import os
import shutil
import time

from . import config
from .util import ago, clip, running_in, until

# Defaults, kept for importers and docs; the live values come from config.alert_rules() (the user can override every number).
CTX_AMBER, CTX_RED = 85, 95     # context fill (%) at which a chat on a 200k window turns AMBER / RED (1M windows: 60 / 90)
IDLE_SECS = 3600                # a live chat idle this long is AMBER: it still holds memory
LIMIT_WARN = 80                 # a usage limit at or above this (%) is worth a warning


def ctx_pct(r):
    return round(100 * r["ctx"] / r["window"]) if r["window"] else 0


def ctx_levels(r):
    """(amber %, red %) for this chat: what the user set for it, else the configured levels for a 200k or 1M window, else the suggestion
    for its size (a bigger window warns earlier in percent)."""
    mine = config.chat_levels(r.get("session_id") or "")
    if mine:
        return mine
    w, rules = r["window"], config.alert_rules()["context"]
    if w <= config.WINDOW_CLASS_MAX:
        return tuple(rules["200k"])
    return tuple(rules["1m"]) if w == 1_000_000 else config.suggest_levels(w)


def mem_text(mb):
    return f"{mb / 1000:.1f} GB" if mb >= 1000 else f"{int(mb)} MB"


def idle_too_long(r):
    floor = config.alert_rules()["memory"]["idle_floor_mb"]
    return bool(r["active"] and r["state"] == "idle" and time.time() - r["last_run"] > IDLE_SECS and (r["mem_mb"] or 0) >= floor)


def chat_mem_level(r):
    """OK | AMBER | RED for one live chat's own memory (its process and children)."""
    amber, red = config.alert_rules()["memory"]["chat_mb"]
    mb = r["mem_mb"] or 0
    return "RED" if mb >= red else "AMBER" if mb >= amber else "OK"


def busy_stuck(r):
    """Busy, but the rollout has had no output for a long time (a long build is normal; hours of silence is not)."""
    mins = config.alert_rules()["time"]["busy_stuck_min"]
    return bool(r["active"] and r["state"] == "busy" and time.time() - r["last_run"] > mins * 60)


def waiting_for(r):
    """How long a chat has been waiting on the user, e.g. '14m', or None when it is under 2 minutes or unknown."""
    since = r.get("status_since")
    return ago(since) if r.get("waiting") and since and time.time() - since >= 120 else None


def _raise(level, to):
    return to if level == "OK" or (level == "AMBER" and to == "RED") else level


def health(r):
    """(OK | AMBER | RED, reasons): the one answer to 'does this chat need me?'."""
    pct = ctx_pct(r)
    amber, red = ctx_levels(r)
    level, why = "OK", []
    if pct >= amber:
        level = "RED" if pct >= red else "AMBER"
        why.append(f"context {pct}% full" + ("" if r["active"] else " when it ended"))
    if r["active"]:
        if r["waiting"]:
            level = _raise(level, "AMBER")
            how_long = waiting_for(r)
            why.append(f"waiting on approval ({r['waiting']})" + (f" for {how_long}" if how_long else ""))
        ml = chat_mem_level(r)
        if ml != "OK":
            level = _raise(level, ml)
            why.append(f"using {mem_text(r['mem_mb'])} of memory")
        if idle_too_long(r):
            level = _raise(level, "AMBER")
            why.append(f"idle {ago(r['last_run'])}, holding {mem_text(r['mem_mb'])}")
        if busy_stuck(r):
            level = _raise(level, "AMBER")
            why.append(f"busy, but no output for {ago(r['last_run'])}: may be stuck")
    return level, why


def tips(r):
    """What to do about each reason health() gave (shown on standard and full cards)."""
    t = []
    pct = ctx_pct(r)
    if r["waiting"]:
        t.append(f"waiting on approval ({r['waiting']}): answer it in {running_in(r)}")
    if pct >= ctx_levels(r)[0]:
        t.append(f"context ~{pct}% full: /compact (or let Codex auto-compact), or start clean (see `clean` above) and paste the latest prompt or a handoff note")
    if r["active"] and chat_mem_level(r) != "OK":
        t.append(f"using {mem_text(r['mem_mb'])}: close the chat to free it (resume later with the command above), or start clean")
    if idle_too_long(r):
        t.append(f"idle {ago(r['last_run'])}, holding {mem_text(r['mem_mb'])}: close it to free memory (resume later with the command above)")
    if busy_stuck(r):
        t.append(f"no output for {ago(r['last_run'])} while busy: look at it in {running_in(r)}; interrupt it (Esc) or close it if it is stuck")
    return t


def ram_bytes():
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (ValueError, OSError, AttributeError):
        return 0


def system_alerts(rows, ram=None, disk_free=None):
    """Machine-level items: all live chats together against RAM, and free disk. -> [dict(key, kind, level, title, headline, tips)]."""
    rules, out = config.alert_rules()["memory"], []
    ram = ram if ram is not None else ram_bytes()
    live = [r for r in rows if r["active"]]
    held = sum(r["mem_mb"] or 0 for r in live)
    if ram and held:
        share = round(100 * held * 1e6 / ram)
        amber, red = rules["system_pct"]
        if share >= amber:
            top = sorted(live, key=lambda r: -(r["mem_mb"] or 0))[:5]
            out.append(dict(key="system:memory", kind="memory", level="RED" if share >= red else "AMBER", title="Memory held by live chats",
                            headline=f"{mem_text(held)} = {share}% of this machine's RAM",
                            culprits=[dict(sid=r["session_id"], label=r["name"] or r["title"], mem_mb=r["mem_mb"] or 0) for r in top],
                            tips=["Close the chats you are not using; the biggest are " + ", ".join(f"{clip(r['name'] or r['title'], 24)} ({mem_text(r['mem_mb'] or 0)})" for r in top[:3]) + "."]))
    try:
        free = disk_free if disk_free is not None else shutil.disk_usage(config.HOME).free
    except OSError:
        free = None
    if free is not None:
        gb, (amber, red) = free / 1e9, rules["disk_free_gb"]
        if gb < amber:
            out.append(dict(key="system:disk", kind="disk", level="RED" if gb < red else "AMBER", title="Disk space",
                            headline=f"{gb:.0f} GB free on the home volume", culprits=[],
                            tips=["Old chats keep scratch files; see the Housekeeping advice on ended chats, or clear old ~/.codex/shell_snapshots and ~/.codex/visualizations."]))
    return out


def warnings_for(rows, limits):
    """One line per usage limit, machine-level problem or live chat that needs attention."""
    warn = []
    for l in limits:
        if (l.get("percent") or 0) >= LIMIT_WARN:
            warn.append(f"{l['kind'].replace('_', ' ')} limit at {l['percent']}%, resets {until(l.get('resets_at'))}")
    warn += [f"{s['title']}: {s['headline']}" for s in system_alerts(rows)]
    for r in rows:
        if r["active"]:
            level, why = health(r)
            if why:
                warn.append(f"{clip(r['name'] or r['title'], 34)} ({running_in(r)}): " + ", ".join(why))
    return warn
