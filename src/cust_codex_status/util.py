"""Formatting helpers shared by every module: numbers, times, colours, bars, padding."""
import datetime as dt
import os
import re
import sys
import time

from .config import HOME, VIA


def fmt(n):
    n = n or 0
    return f"{n/1e6:.1f}M" if n >= 1e6 else f"{n/1e3:.1f}k" if n >= 1e3 else str(int(n))


def ago(ts):
    s = max(0, time.time() - ts)
    return f"{int(s)}s" if s < 90 else f"{int(s/60)}m" if s < 5400 else f"{s/3600:.0f}h" if s < 172800 else f"{s/86400:.0f}d"


def until(iso):
    try:
        t = dt.datetime.fromisoformat(iso).timestamp()
    except Exception:
        return "?"
    d = t - time.time()
    if d <= 0:
        return "already reset"
    return f"in {int(d/60)}m" if d < 5400 else f"in {d/3600:.1f}h" if d < 172800 else f"in {d/86400:.1f}d"


def short_model(m):
    return m or "-"


def iso_ts(t):
    try:
        return dt.datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def running_in(r):
    app = (r["host"] if r["active"] and r["host"] else r["source"]) or "?"
    via = VIA.get(r["entry"], r["entry"] or "")
    return f"{app} · {via}" if via and via.lower() != app.lower() and not (app == "terminal" and via == "CLI") else app + (" · CLI" if app == "terminal" else "")


def clip(text, n):
    text = " ".join((text or "-").split())
    return text if len(text) <= n else text[: n - 1] + "…"


def term_width():
    try:
        return os.get_terminal_size().columns - C.margin if sys.stdout.isatty() else 160
    except OSError:
        return 160


def home_rel(p):
    return (p or "").replace(HOME, "~")


class C:  # ANSI colours, disabled when not a tty / --no-color
    on = False
    margin = 0          # columns the full-screen view keeps for its selection gutter

    @classmethod
    def w(cls, code, s):
        return f"\033[{code}m{s}\033[0m" if cls.on else s


def bar(pct, width=14):
    pct = max(0, min(100, pct or 0))
    n = round(width * pct / 100)
    col = "32" if pct < 60 else "33" if pct < 85 else "31"
    return C.w(col, "█" * n) + C.w("90", "░" * (width - n))


ANSI = re.compile(r"\033\[[0-9;]*m")


def vlen(s):
    return len(ANSI.sub("", s))


def pad(s, w, align="l"):
    gap = " " * max(0, w - vlen(s))
    return gap + s if align == "r" else s + gap
