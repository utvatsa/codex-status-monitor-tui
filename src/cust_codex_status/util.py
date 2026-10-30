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


# The Codex palette: near-black ink, orchid primary, coral secondary, off-white text. Each role is (256-colour code, 8-colour fallback).
# ok / amber / red mean health and nothing else. A dark-terminal palette; `text` and `dim` darken when COLORFGBG says the background is light.
PALETTE = {
    "primary": (171, 35),      # orchid: frames' titles, resume commands, the cursor, bars that are not health
    "secondary": (209, 95),    # coral: markers, selection, numbers
    "frame": (133, 35),        # muted orchid: box edges
    "text": (253, 39),         # off-white
    "dim": (245, 90),          # secondary text
    "faint": (240, 90),        # archived frames, empty bar tracks
    "ink": (233, 30),          # near-black: text on a coloured block
    "ok": (78, 32),
    "amber": (214, 33),
    "red": (203, 31),
}
LIGHT_BG = {"text": 236, "dim": 243, "faint": 247}


def detect_depth(env=None):
    """256 when the terminal says it can show them, else the 8 ANSI colours."""
    env = os.environ if env is None else env
    if env.get("COLORTERM", "").lower() in ("truecolor", "24bit") or "256" in env.get("TERM", ""):
        return 256
    return 8


def _light_background(env=None):
    env = os.environ if env is None else env
    return env.get("COLORFGBG", "").rsplit(";", 1)[-1] in ("7", "15")


class C:  # ANSI colours, disabled when not a tty / --no-color
    on = False
    depth = 256         # 256 or 8: how many colours the palette may use (set from the terminal by `use_terminal`)
    light = False
    margin = 0          # columns the full-screen view keeps for its selection gutter

    @classmethod
    def use_terminal(cls, depth=None):
        cls.depth = depth or detect_depth()
        cls.light = _light_background()

    @classmethod
    def w(cls, code, s):
        return f"\033[{code}m{s}\033[0m" if cls.on else s

    @classmethod
    def code(cls, name, bg=False):
        """SGR parameters of a palette role as a foreground (or background) colour."""
        big, small = PALETTE[name]
        if cls.depth >= 256:
            if cls.light and name in LIGHT_BG:
                big = LIGHT_BG[name]
            return f"{48 if bg else 38};5;{big}"
        return str(small + 10) if bg and small != 39 else str(small) if not bg else "49"

    @classmethod
    def index(cls, name):
        """The colour number of a palette role for curses (-1 = the terminal's default colour)."""
        big, small = PALETTE[name]
        if cls.depth >= 256:
            return LIGHT_BG.get(name, big) if cls.light else big
        return -1 if small == 39 else small % 8

    @classmethod
    def t(cls, name, s, bold=False):
        """Text in a palette role (bold on request)."""
        return cls.w(("1;" if bold else "") + cls.code(name), s)

    @classmethod
    def block(cls, name, s):
        """Bold near-black text on a solid block of a palette role (badges, the cursor, key caps)."""
        return cls.w("1;" + cls.code("ink") + ";" + cls.code(name, bg=True), s)


def bar(pct, width=14, tone=None):
    """A thin gauge. Without `tone` it is a health gauge (green, amber, red as it fills); with one it is just a measure."""
    pct = max(0, min(100, pct or 0))
    n = max(1 if pct else 0, round(width * pct / 100))      # a non-zero value always shows at least one cell
    name = tone or ("ok" if pct < 60 else "amber" if pct < 85 else "red")
    return (C.t(name, "━" * n) if n else "") + (C.t("faint", "┄" * (width - n)) if width > n else "")


ANSI = re.compile(r"\033\[[0-9;]*m")


def vlen(s):
    return len(ANSI.sub("", s))


def pad(s, w, align="l"):
    gap = " " * max(0, w - vlen(s))
    return gap + s if align == "r" else s + gap
