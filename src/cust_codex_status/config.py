"""Paths and lookup tables. Everything the tool reads lives under HOME, so tests can point it elsewhere."""
import json
import os
import time


HOME = os.path.expanduser("~")
CODEX = os.environ.get("CODEX_HOME") or f"{HOME}/.codex"       # Codex's own home; CODEX_HOME overrides it (tests point it at a temp folder)


USER_CONFIG = f"{HOME}/.config/cust-codex-status/config.json"    # the tool's own settings: the web add-on switch, context windows and alert rules


WEB_PORT = 8765            # first port the web view tries; the next 20 are tried before a random free one


WEB_IDLE_SECS = 60         # the web server stops itself when no browser has been connected this long


def user_config():
    try:
        with open(USER_CONFIG) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def web_enabled():
    """The web add-on is on unless turned off (`--set-web off`, `./install.sh --no-web`); CUST_CODEX_STATUS_WEB=0/1 overrides."""
    env = os.environ.get("CUST_CODEX_STATUS_WEB")
    if env is not None:
        return env.strip().lower() not in ("0", "off", "false", "no")
    return user_config().get("web", True) is not False


def save_config(d):
    """Write the tool's own config atomically. The tool's only file write besides the clipboard, and only on request."""
    os.makedirs(os.path.dirname(USER_CONFIG), exist_ok=True)
    tmp = USER_CONFIG + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f, indent=2)
        f.write("\n")
    os.replace(tmp, USER_CONFIG)
    return USER_CONFIG


def set_web(on):
    """Save the web add-on switch."""
    d = user_config()
    d["web"] = bool(on)
    return save_config(d)


# ---- context windows and alert rules ----------------------------------------------------------------------------------
# Codex records the real window in every token_count event (model_context_window), so the window is resolved (see data.window_for) from:
# a config override, what the rollout reported, ~/.codex/models_cache.json, this table, then WINDOW_GUESS.
DEFAULT_WINDOWS = {}                                       # model id (substring) -> window; only what we were told
WINDOW_SMALL = 200_000                                     # anchor of the "200k" alert class
WINDOW_CLASS_MAX = 300_000                                 # a window up to this uses the "200k" alert levels (Codex's usual ~258k lands here)
WINDOW_GUESS = 258_400                                     # when nothing says otherwise

# Every number an alert uses. Override any of them under "alerts" in the config file; unknown keys are ignored.
DEFAULT_RULES = {
    "context": {"200k": [85, 95], "1m": [60, 90]},          # [amber %, red %] of the window, by window class
    "memory": {"chat_mb": [1500, 3000],                      # one chat (its process and children): amber, red
               "idle_floor_mb": 150,                         # an idle chat only counts as "holding memory" above this
               "system_pct": [25, 40],                       # all live chats together, as a share of the machine's RAM
               "disk_free_gb": [10, 3]},                     # free space on the home volume: amber below the first, red below the second
    "time": {"busy_stuck_min": 20,                           # busy with no rollout output this long: maybe stuck
             "live_idle_min": 30,                            # a chat in a shared app-server (desktop / VS Code) counts as live this long after its last event
             "waiting_secs": 30,                             # a tool call unanswered this long while approvals are required: waiting on you
             "limits_stale_min": 15},                        # usage limits older than this are flagged STALE
    "advice": {"scratch_mb": 25, "scratch_days": 7, "archive_days": 3, "transcript_mb": 50},
}


def parse_size(v):
    """'1m' / '200k' / '1.5m' / 500000 -> tokens, or None when it is not a sensible window (10k to 10M)."""
    try:
        s = str(v).strip().lower()
        n = float(s[:-1]) * 1_000_000 if s.endswith("m") else float(s[:-1]) * 1_000 if s.endswith("k") else float(s)
    except (ValueError, IndexError):
        return None
    return int(n) if 10_000 <= n <= 10_000_000 else None


def _merge(base, over):
    out = {}
    for k, v in base.items():
        o = over.get(k) if isinstance(over, dict) else None
        out[k] = _merge(v, o) if isinstance(v, dict) else (o if isinstance(o, type(v)) and (not isinstance(v, list) or len(o) == len(v)) else v)
    return out


def alert_rules():
    """Defaults overlaid with the user's `alerts` block (read each time, so an edit applies without a restart)."""
    return _merge(DEFAULT_RULES, user_config().get("alerts"))


def window_overrides():
    """model id or session id (8 chars) -> tokens, from `windows` in the config."""
    out = {}
    for k, v in (user_config().get("windows") or {}).items():
        n = parse_size(v)
        if n:
            out[str(k)] = n
    return out


def suggest_levels(window):
    """Suggested (amber %, red %) for any window size. Anchored on the defaults (200k: 85/95, 1M: 60/90) and interpolated on a log scale
    between them: the bigger the window, the earlier the warning in percent (quality and cost suffer long before the hard limit), but
    the later in tokens. Below 200k it stays at 85/95; above 1M it keeps falling slowly (2M: ~51/87). Red is at least 5 points after amber."""
    import math
    k = min(max(math.log(max(window, WINDOW_SMALL) / WINDOW_SMALL) / math.log(5), 0.0), 1.6)
    amber = int(round(85 - 25 * k))
    red = max(int(round(95 - 5 * k)), amber + 5)
    return max(amber, 20), min(red, 99)


def chat_key(sid):
    """Codex chat ids are UUIDv7, whose first 8 characters are only a ~65 s time slice, so the key is the full millisecond prefix (13 characters)."""
    return str(sid)[:13]


def by_prefix(table, sid):
    """The entry of a per-chat table whose key (8+ characters) is a prefix of this chat id; the longest key wins."""
    keys = [k for k in (table or {}) if len(str(k)) >= 8 and is_chat_id(k) and str(sid).startswith(str(k))]
    return table[max(keys, key=len)] if keys else None


def chat_levels(sid):
    """(amber, red) the user chose for one chat, or None."""
    v = by_prefix(user_config().get("chat_levels"), sid)
    return tuple(v) if isinstance(v, list) and len(v) == 2 and all(isinstance(x, int) for x in v) else None


PRUNE_DAYS = 90                  # a chat's own setting is forgotten once it is this old AND its chat has been quiet this long


def prune_chats(d, now=None, days=PRUNE_DAYS):
    """Drop per-chat settings (windows / chat_levels by chat id) that are old and whose chat is gone or quiet. Works on the config dict in
    place and only runs when the tool is already writing the config (it never writes by itself). Entries written before timestamps existed
    are stamped now, not dropped. Model ids in `windows` are never touched."""
    import glob
    now = now or time.time()
    stamps = d["chat_set"] if isinstance(d.get("chat_set"), dict) else {}
    wins = d["windows"] if isinstance(d.get("windows"), dict) else {}
    lvls = d["chat_levels"] if isinstance(d.get("chat_levels"), dict) else {}
    for key in {k for k in list(wins) + list(lvls) if len(k) >= 8 and is_chat_id(k)}:
        if not isinstance(stamps.get(key), (int, float)):
            stamps[key] = now
            continue
        if now - stamps[key] <= days * 86400:
            continue
        quiet = True
        for path in glob.glob(f"{CODEX}/sessions/*/*/*/rollout-*{key}*.jsonl") + glob.glob(f"{CODEX}/archived_sessions/rollout-*{key}*.jsonl"):
            try:
                if now - os.path.getmtime(path) <= days * 86400:
                    quiet = False
            except OSError:
                pass
        if quiet:
            wins.pop(key, None); lvls.pop(key, None); stamps.pop(key, None)
    for key in [k for k in stamps if k not in wins and k not in lvls]:
        stamps.pop(key)
    d["windows"], d["chat_levels"], d["chat_set"] = wins, lvls, stamps
    return d


def set_chat(sid, size, amber=None, red=None):
    """One chat's own context window and (optionally) its alert levels; nothing else changes. Without levels the suggestion for the size is used.
    Also the moment old settings of chats that are long gone are pruned."""
    n = parse_size(size)
    key = chat_key(sid)
    if not n or len(key) < 8:
        raise ValueError("a chat id (8+ characters) and a window size (like 600k or 1m) are needed")
    if (amber is None) != (red is None):
        raise ValueError("give both alert levels or neither")
    if amber is not None and not (1 <= amber < red <= 100):
        raise ValueError("levels must satisfy 1 <= amber < red <= 100")
    d = user_config()
    w, lv = dict(d.get("windows") or {}), dict(d.get("chat_levels") or {})
    w[key] = n
    if amber is None:
        lv.pop(key, None)
    else:
        lv[key] = [int(amber), int(red)]
    stamps = dict(d.get("chat_set") or {})
    stamps[key] = time.time()
    d["windows"], d["chat_levels"], d["chat_set"] = w, lv, stamps
    return save_config(prune_chats(d))


def clear_chat(sid):
    d = user_config()
    key = chat_key(sid)
    for name in ("windows", "chat_levels", "chat_set"):
        if isinstance(d.get(name), dict):
            d[name].pop(key, None)
    return save_config(d)


def set_window(model, size):
    n = parse_size(size)
    if not n or not str(model).strip():
        raise ValueError("a model id (like opus-5-5) and a size (200k, 1m or a token count) are needed")
    d = user_config()
    w = d.get("windows") if isinstance(d.get("windows"), dict) else {}
    w[str(model).strip()] = size if isinstance(size, str) else n
    d["windows"] = w
    return save_config(d)


def clear_window(model):
    d = user_config()
    if isinstance(d.get("windows"), dict):
        d["windows"].pop(str(model).strip(), None)
    return save_config(d)


def is_chat_id(target):
    """A chat id (or its first 8+ hex characters) rather than a model id."""
    import re
    return bool(re.fullmatch(r"[0-9a-f]{8}(-?[0-9a-f-]*)?", str(target).strip().lower()))


def set_context(window, amber, red):
    if window not in ("200k", "1m") or not (1 <= amber < red <= 100):
        raise ValueError("window must be 200k or 1m, and 1 <= amber < red <= 100")
    d = user_config()
    a = d.get("alerts") if isinstance(d.get("alerts"), dict) else {}
    c = a.get("context") if isinstance(a.get("context"), dict) else {}
    c[window] = [int(amber), int(red)]
    a["context"] = c
    d["alerts"] = a
    return save_config(d)


ARCHIVE_DEFAULT = 20       # archived rows shown unless -n asks for more (or 0 for all)


RUNNING_SECS = 90          # a rollout written this recently counts as "running"


# Codex says where a chat runs in two places: session_meta.source ("cli", "exec", "vscode", ...) and .originator ("Codex Desktop", "codex_cli_rs", ...).
ENTRY_LABEL = {"cli": "terminal", "exec": "exec", "vscode": "VS Code", "desktop": "Desktop", "acp": "JetBrains", "mcp": "MCP", "appserver": "app-server"}


HOSTS = {"idea": "IntelliJ", "webstorm": "WebStorm", "pycharm": "PyCharm", "goland": "GoLand", "Electron": "VS Code",
         "Code Helper": "VS Code", "Cursor": "Cursor", "zed": "Zed", "ChatGPT": "Desktop", "Codex": "Desktop"}


VIA = {"acp": "ACP plugin", "cli": "CLI", "vscode": "extension", "desktop": "desktop app", "exec": "codex exec"}
