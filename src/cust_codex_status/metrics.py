"""Codex-specific headline numbers, computed once so the terminal view and the web view show the same thing.

Codex counts cached tokens inside input; here `input` is uncached input and `cache_read` the cached part (see data.sum_tokens), so the
cache hit rate is cache_read / (input + cache_read). Reasoning tokens are already inside output."""
from .health import ctx_levels, ctx_pct
from .util import running_in


def _level(r):
    """OK | AMBER | RED for how full this chat's context is (its own alert levels)."""
    amber, red = ctx_levels(r)
    pct = ctx_pct(r)
    return "RED" if pct >= red else "AMBER" if pct >= amber else "OK"


def _pct(a, b):
    return round(100 * a / b) if b else None


def _count(values):
    """[(value, how many)], most common first (ties keep first-seen order)."""
    seen = {}
    for v in values:
        seen[v] = seen.get(v, 0) + 1
    return sorted(seen.items(), key=lambda kv: -kv[1])


def busiest_limit(limits):
    """The most-used rate-limit window (5-hour or weekly): dict(label, percent, resets_at) or None."""
    ls = [l for l in (limits or []) if l.get("percent") is not None]
    if not ls:
        return None
    top = max(ls, key=lambda l: l["percent"])
    return dict(label=top.get("label") or top.get("kind"), percent=top["percent"], resets_at=top.get("resets_at"))


def codex_metrics(rows, limits=None):
    """Metrics over the live chats (`active`). Every value is None when there is nothing to base it on. `limits` (the usage limit list, optional)
    adds `rate_limit`: the busiest window."""
    live = [r for r in rows if r["active"]]
    t = lambda rs, k: sum((r["tokens"].get(k) or 0) for r in rs)
    inp, cached, out, reas, turns = t(live, "input"), t(live, "cache_read"), t(live, "output"), t(live, "reasoning"), t(live, "turns")
    total = inp + cached + out
    heads = sorted(((100 - ctx_pct(r), r) for r in live), key=lambda x: x[0])
    tight = heads[0] if heads else None
    return dict(
        threads=len(live), turns=turns, tokens=total,
        cache_pct=_pct(cached, inp + cached), cached=cached, fresh_input=inp,
        reasoning_pct=_pct(reas, out), reasoning=reas, output=out,
        tokens_per_turn=round(total / turns) if turns else None,
        headroom_pct=tight[0] if tight else None, headroom_chat=(tight[1]["name"] or tight[1]["title"]) if tight else None,
        headroom_level=_level(tight[1]) if tight else None,
        approval=_count(r.get("approval") or "default" for r in live), effort=_count(r["effort"] for r in live if r.get("effort")),
        models=_count(r["model"] for r in live if r.get("model")), surfaces=_count(running_in(r) for r in live),
        rate_limit=busiest_limit(limits))
