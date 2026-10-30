"""The metric tile strip at the top of the report: six Codex numbers as boxes side by side (3 x 2 on a narrower screen, one-line chips on a small one).

Pure text, no I/O. `build()` turns `metrics.codex_metrics` (plus the health counts and the per-chat token rates) into specs; `strip()`
draws them as boxes and `chips()` as one-line cells for small views and tight terminals. The numbers are the same ones the web page shows."""
import re

from .metrics import codex_metrics
from .util import C, bar, clip, fmt, pad, until, vlen

SPARK = "▁▂▃▄▅▆▇█"
MIN_TILE = 19            # narrowest tile (columns, borders included) worth drawing as a box


def spark(values, width):
    """One glyph per value (scaled to the largest), at most `width` of them."""
    vals = [v for v in values if v is not None][:width]
    top = max(vals) if vals else 0
    return "".join(SPARK[min(7, int(7 * v / top))] if top else SPARK[0] for v in vals)


def _pct(v):
    return "–" if v is None else f"{v}%"


def segments(counts, width):
    """A health bar made of OK / AMBER / RED runs, each at least one cell when its count is above zero. `counts` = [(n, tone)]."""
    total = sum(n for n, _ in counts)
    if not total:
        return C.t("faint", "┄" * width)
    cells = [max(1, round(width * n / total)) if n else 0 for n, _ in counts]
    while sum(cells) > width:
        cells[cells.index(max(cells))] -= 1
    while sum(cells) < width:
        cells[cells.index(max(cells))] += 1
    return "".join(C.t(tone, "━" * c) for c, (_, tone) in zip(cells, counts) if c)


def _effort_note(eff, has_output, none):
    """(long, short) wording for the most common reasoning effort among the live chats."""
    if not eff:
        return ("effort not recorded", "no effort set") if has_output else (none, none)
    top, n = eff[0]
    long = f"effort {top}" + (f" ×{n}" if len(eff) > 1 or n > 1 else "") + "".join(f" · {e} ×{k}" for e, k in eff[1:3])
    return long, f"effort {top}"


def _health_note(cnt):
    """(long, short) wording of the OK / AMBER / RED counts; levels with none are left out."""
    parts = [(cnt.get(k, 0), k, a) for k, a in (("OK", "OK"), ("AMBER", "AMB"), ("RED", "RED")) if cnt.get(k, 0)]
    if not parts:
        return ("no live threads",) * 2
    return " · ".join(f"{n} {k}" for n, k, _ in parts), " ".join(f"{n} {a}" for n, _, a in parts)


def _spark_gauge(per_chat, w):
    if not len(per_chat):
        return C.t("faint", "┄" * w)
    tail = " per thread"
    return C.t("primary", spark(per_chat, w - len(tail))) + C.t("dim", tail) if w >= len(tail) + 3 else C.t("primary", spark(per_chat, w))


def build(m, cnt, per_chat=()):
    """The six tile specs. m = codex_metrics(...); cnt = {"OK": n, "AMBER": n, "RED": n} for the live chats;
    per_chat = tokens per turn of each live chat (for the sparkline).
    A spec: label, short (chip label), value, unit, gauge (a callable width -> text), note (long, short)."""
    live = m["threads"]
    none = "–"
    tone = {"OK": "ok", "AMBER": "amber", "RED": "red"}
    eff = m["effort"]
    rl = m.get("rate_limit")
    hd = m["headroom_pct"]
    lvl = {"OK": "ok", "AMBER": "amber", "RED": "red"}.get(m.get("headroom_level"), "ok")
    return [
        dict(label="THREADS", short="THREADS", value=str(live), unit="live",
             gauge=lambda w: segments([(cnt.get(k, 0), tone[k]) for k in ("OK", "AMBER", "RED")], w),
             note=_health_note(cnt)),
        dict(label="CACHE HIT", short="CACHE", value=_pct(m["cache_pct"]), unit="of input" if m["cache_pct"] is not None else "",
             gauge=lambda w: bar(m["cache_pct"] or 0, w, "primary"),
             note=(f"cached {fmt(m['cached'])} of {fmt(m['cached'] + m['fresh_input'])}", f"{fmt(m['cached'])}/{fmt(m['cached'] + m['fresh_input'])}")
             if m["cache_pct"] is not None else (none, none)),
        dict(label="REASONING", short="REASON", value=_pct(m["reasoning_pct"]), unit="of output" if m["reasoning_pct"] is not None else "",
             gauge=lambda w: bar(m["reasoning_pct"] or 0, w, "secondary"),
             note=_effort_note(eff, m["reasoning_pct"] is not None, none)),
        dict(label="CONTEXT HEADROOM", short="HEADROOM", value=_pct(hd), unit="left" if hd is not None else "",
             gauge=lambda w: bar(hd or 0, w, lvl) if hd is not None else bar(0, w, "faint"),
             note=(m["headroom_chat"] or none,) * 2 if hd is not None else (none, none)),
        dict(label="TOKENS / TURN", short="TOK/TURN", value=fmt(m["tokens_per_turn"]) if m["tokens_per_turn"] else "–", unit="avg" if m["tokens_per_turn"] else "",
             gauge=lambda w: _spark_gauge(per_chat, w),
             note=(f"{m['turns']} turns · {fmt(m['tokens'])} tokens", f"{m['turns']} turns") if m["turns"] else (none, none)),
        dict(label="RATE LIMIT", short="LIMIT", value=_pct(rl["percent"]) if rl else "–", unit=re.split(r"[ ·_]", rl["label"] or "")[0] if rl else "",
             gauge=lambda w: bar(rl["percent"], w) if rl else bar(0, w, "faint"),
             note=((f"resets {until(rl['resets_at'])}",) * 2) if rl else ("no limit data yet", "no limit data")),
    ]


def columns_for(width):
    """How many tiles share a row: 6 when each can be at least MIN_TILE wide, else 3, else 2."""
    for n in (6, 3, 2):
        if width >= n * MIN_TILE:
            return n
    return 1


def _tile(spec, w):
    """One boxed tile, `w` columns wide, 5 rows: top edge with the label, value, gauge, note, bottom edge."""
    iw = w - 4
    label = spec["label"] if len(spec["label"]) <= iw - 1 else spec["short"]
    label = clip(label, iw - 1)
    top = C.t("frame", "┌─") + C.t("secondary", "▍") + C.t("primary", label, bold=True) + " " + C.t("frame", "─" * max(0, w - 5 - len(label)) + "┐")
    val = C.t("text", spec["value"], bold=True) + (" " + C.t("dim", spec["unit"]) if spec["unit"] else "")
    note = next((n for n in spec["note"] if len(n) <= iw), clip(spec["note"][-1], iw))
    edge = C.t("frame", "│")
    body = [val, spec["gauge"](iw), C.t("dim", note)]
    return [top] + [edge + " " + pad(b, iw) + " " + edge for b in body] + [C.t("frame", "└" + "─" * (w - 2) + "┘")]


def strip(specs, width):
    """The boxed strip: rows of tiles side by side (their borders touch), filling `width` exactly."""
    n = columns_for(width)
    out = []
    for i in range(0, len(specs), n):
        group = specs[i:i + n]
        widths = [width // len(group) + (1 if k < width % len(group) else 0) for k in range(len(group))]
        tiles = [_tile(s, w) for s, w in zip(group, widths)]
        out += ["".join(t[r] for t in tiles) for r in range(5)]
    return out


def chips(specs, width):
    """One-line cells (`▍CACHE 82% of input`) packed into lines no wider than `width`; one cell per line when even two do not fit."""
    cells = [C.t("secondary", "▍") + C.t("dim", s["short"] + " ") + C.t("text", s["value"], bold=True) + (C.t("dim", " " + s["unit"]) if s["unit"] else "") for s in specs]
    lines, cur = [], ""
    for c in cells:
        if cur and vlen(cur) + 3 + vlen(c) > width:
            lines.append(cur)
            cur = ""
        cur = cur + "   " + c if cur else c
    return lines + [cur] if cur else lines


def mix(m, width):
    """Approval policy / model / surface of the live chats, as `label a 2 · b 1` groups; a group per line when they do not fit on one."""
    def group(label, pairs):
        if not pairs:
            return None
        shown = " · ".join(f"{k} {n}" for k, n in pairs[:3]) + (f" · +{len(pairs) - 3} more" if len(pairs) > 3 else "")
        return C.t("dim", label + " ") + C.t("text", shown)
    gs = [g for g in (group("approval", m["approval"]), group("model", m["models"]), group("surface", m["surfaces"])) if g]
    sep = C.t("frame", "  │  ")
    line = sep.join(gs)
    return [line] if gs and vlen(line) <= width else gs


def tile_lines(rows, usage_limits, cnt, width, compact):
    """Everything under the title: the tiles (boxes, or chips when `compact` or the width is small) and the mix lines. Returns (lines, metrics)."""
    m = codex_metrics(rows, usage_limits)
    per = [round(sum(r["tokens"].get(k) or 0 for k in ("input", "cache_read", "output")) / r["tokens"]["turns"]) for r in rows if r["active"] and r["tokens"].get("turns")]
    specs = build(m, cnt, per)
    lines = chips(specs, width) if compact or width < 2 * MIN_TILE + 1 else strip(specs, width)
    return lines + mix(m, width), m
