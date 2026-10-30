"""Static output: panels, cards, badges and the full report (`render_ui`). Pure text, no I/O."""
import time

from . import config
from .health import ctx_pct, health, tips, warnings_for
from .util import ANSI, C, ago, bar, clip, fmt, home_rel, pad, running_in, short_model, term_width, until, vlen
from .views import level_name


def panel(title, right, lines, width, accent="35"):
    """Rounded box: coloured title on the left of the top edge, dim note on the right, lines padded to fit."""
    inner = width - 4
    t = " " + C.w("1;" + accent, title) + " " if title else ""
    rt = " " + C.w("90", right) + " " if right else ""
    fill = max(1, width - 2 - vlen(t) - vlen(rt) - 1)
    out = [C.w(accent, "╭─") + t + C.w(accent, "─" * fill) + rt + C.w(accent, "╮")]
    for ln in lines:
        if vlen(ln) > inner:                       # last-resort guard: never break the frame
            ln = ANSI.sub("", ln)[: inner - 1] + "…"
        out.append(C.w(accent, "│") + " " + pad(ln, inner) + " " + C.w(accent, "│"))
    out.append(C.w(accent, "╰" + "─" * (width - 2) + "╯"))
    return out


DOT = {"idle": ("●", "32"), "busy": ("●", "33"), "running?": ("◐", "33"), "ended": ("○", "90")}


def state_dot(r):
    ch, col = DOT.get(r["state"], ("○", "90"))
    return C.w(col, ch + " " + r["state"] + ("*" if r["waiting"] else ""))


HCOL = {"OK": "32", "AMBER": "33", "RED": "31"}


HBADGE = {"OK": "1;30;42", "AMBER": "1;30;43", "RED": "1;97;41"}


def badge_small(level):
    return C.w(HBADGE[level], f" {level} ") if C.on else f"[{level}]"


def badge_big(level):
    """Three rows, 9 columns wide: a solid coloured block with the level in the middle."""
    rows = [" " * 9, f"{level:^9}", " " * 9]
    return [C.w(HBADGE[level], t) for t in rows] if C.on else ["┌───────┐", f"│{level:^7}│", "└───────┘"]


def ctx_cell(r, width=12):
    pct = ctx_pct(r)
    return f"{bar(pct, width)} {pct:>3}%  {fmt(r['ctx'])}/{fmt(r['window'])}"


def account_fields(acct):
    return [("name", acct.get("name")), ("email", acct.get("email")), ("plan", acct.get("plan")),
            ("sign-in", acct.get("tier")), ("role", acct.get("role")), ("organisation", acct.get("org")),
            ("billing", acct.get("billing")), ("credits", "on" if acct.get("extra") else "off"),
            ("subscribed since", (acct.get("since") or "?")[:10]),
            ("default model", acct.get("default_model") or "-"), ("Codex CLI", acct.get("cli"))]


def resume_cmd(r):
    return (f"cd {home_rel(r['cwd'])} && " if r["cwd"] else "") + f"codex resume {r['session_id']}"


def clean_cmd(r):
    return (f"cd {home_rel(r['cwd'])} && " if r["cwd"] else "") + "codex"


def tok_stats(r):
    """Token line shared by cards and detail rows: turns, uncached input, cache reads, output (reasoning inside it)."""
    t = r["tokens"]
    s = f"turns {t['turns']} · in {fmt(t['input'])} · cache-r {fmt(t['cache_read'])} · out {fmt(t['output'])}"
    return s + (f" (reasoning {fmt(t['reasoning'])})" if t.get("reasoning") else "")


def tok_total(r):
    t = r["tokens"]
    return t["input"] + t["cache_read"] + t["cache_write"] + t["output"]


def detail_lines(r, width, indent="     "):
    """The extra lines a collapsed row (live compact row or archived row) shows when it is the selected chat."""
    t = r["tokens"]
    hl, why = health(r)
    stats = tok_stats(r)
    if r["active"] and r["mem_mb"]:
        stats += f" · {r['mem_mb']}MB"
    out = [C.w("90", "folder ") + home_rel(r["cwd"] or "-"),
           C.w("90", "id     ") + r["session_id"] + (C.w("90", f"   pid {r['pid']}") if r["pid"] else ""),
           C.w("90", "stats  ") + stats,
           C.w("90", "first  ") + clip(r["first_prompt"], width - 8),
           C.w("90", "latest ") + clip(r["latest_prompt"], width - 8),
           C.w("90", "resume ") + C.w("35", resume_cmd(r))]
    if r["active"]:
        out.append(C.w("90", "       ") + C.w("90", f"live in {running_in(r)}: close it there first, or `codex fork {r['session_id']}`"))
    out.append(C.w("90", "clean  ") + clean_cmd(r))
    out += [C.w("33", "▲ " + tp) for tp in tips(r)]
    return [indent + ln for ln in out]


def render_ui(rows, acct, usage, args, hidden=0, items=None):
    """The whole report as text. `items`, when given, is filled with one dict per selectable chat in display order
    (the TUI selects by these; `args.expand` = a session id whose collapsed row should show its details)."""
    W = max(78, min(term_width(), 118))
    expand = getattr(args, "expand", None)
    arc_prompt = getattr(args, "arc_prompt", True)
    items = items if items is not None else []

    def note(n, r):
        items.append(dict(n=n, sid=r["session_id"], name=r["name"] or r["title"], active=r["active"], resume=resume_cmd(r), clean=clean_cmd(r)))
    inner = W - 4
    out = []
    u = usage.get("utilization") or {}
    limits = u.get("limits") or []
    act = [r for r in rows if r["active"]]
    arc = [r for r in rows if not r["active"]]
    toks = lambda rs: sum(tok_total(r) for r in rs)

    # header
    plan = f"{acct.get('plan') or '?'} · {acct.get('tier') or '?'}"
    head = [C.w("1", acct.get("email") or "?") + C.w("90", "   " + plan),
            C.w("90", f"{len(act)} live · {sum(r['mem_mb'] or 0 for r in act)}MB · {fmt(toks(act))} tokens live"
                + (f" · {len(arc)} archived · {fmt(toks(arc))} tokens" if args.show_arc else ""))]
    if args.account:
        head += [C.w("90", f"{k:17}") + str(v) for k, v in account_fields(acct)]
    cnt = {k: sum(1 for r in act if health(r)[0] == k) for k in HCOL}
    head.append(C.w("90", "live health  ") + "   ".join(f"{badge_small(k)} {cnt[k]}" for k in HCOL))
    out += panel("CODEX STATUS", time.strftime("%a %d %b %Y %H:%M:%S") + "  read-only", head, W, "35")

    # usage
    ul = []
    age = (time.time() * 1000 - usage.get("fetchedAtMs", 0)) / 1000 if usage else None
    if limits:
        for l in limits:
            scope = ((l.get("scope") or {}).get("model") or {}).get("display_name")
            label = l.get("label") or {"session": "5-hour session", "weekly_all": "weekly · all models", "weekly_scoped": "weekly"}.get(l["kind"], l["kind"])
            label += f" · {scope}" if scope else ""
            pct = l.get("percent") or 0
            ul.append(f"{pad(label, 20)} {bar(pct, 24)} {pct:>3}%   resets {until(l.get('resets_at'))}"
                      + (C.w("33", "   ◂ binding") if l.get("is_active") else ""))
        for k, v in u.items():
            if isinstance(v, dict) and v.get("limit_dollars") and k != "limits":
                ul.append(f"{pad('credit pool', 20)} ${v.get('used_dollars')} of ${v.get('limit_dollars')} used · {k} · resets {until(v.get('resets_at'))}")
        stale = age and age > config.alert_rules()["time"]["limits_stale_min"] * 60
        ul.append(C.w("90", f"as of the last Codex turn, {ago(time.time() - age)} ago" + (" · STALE, run a prompt in Codex for live numbers" if stale else "")))
    else:
        ul.append("no usage data yet; limits are read from the latest Codex turn")
    if not args.minimal:
        out += panel("USAGE LIMITS", "", ul, W, "34")

    warn = warnings_for(rows, limits)
    if warn and not args.minimal:
        out += panel("ATTENTION", "", [C.w("33", "▲ " + w) for w in warn], W, "33")

    def card(i, r):
        sb = r["subagents"]
        nr = sum(1 for a in sb if a["state"] == "running")
        t = r["tokens"]
        ttl = clip((r["name"] + " · " if r["name"] and r["active"] else "") + r["title"], inner - 40)
        hl, why = health(r)
        state = (f"{pad(state_dot(r), 10)} {pad(short_model(r['model'])[:12], 12)} {ctx_cell(r)}   "
                 + C.w("90", f"last {ago(r['last_active'])}" + (f" · up {r['up']}" if r["active"] and r["up"] else "")))
        stats = tok_stats(r)
        if sb:
            stats += f" · subagents {nr}/{len(sb)}"
        if r["active"] and r["mem_mb"]:
            stats += f" · {r['mem_mb']}MB"
        reason = C.w(HCOL[hl], " · ".join(why)) if why else C.w("90", "nothing needs attention")
        if args.lean:
            lines = [f"{badge_small(hl)} {state}", C.w("90", stats)] + ([reason] if why else [])
        else:
            b = badge_big(hl)
            lines = [f"{b[0]}  {state}", f"{b[1]}  {reason}", f"{b[2]}  " + C.w("90", stats)]
            lines.append(C.w("90", "folder ") + home_rel(r["cwd"] or "-"))
            lines.append(C.w("90", "id     ") + r["session_id"] + (C.w("90", f"   pid {r['pid']}") if r["pid"] else ""))
        if not args.no_prompts and not args.lean:
            lines.append(C.w("90", "first  ") + clip(r["first_prompt"], inner - 8))
            lines.append(C.w("90", "latest ") + clip(r["latest_prompt"], inner - 8))
        go = f"cd {home_rel(r['cwd'])} && " if r["cwd"] else ""
        lines.append(C.w("90", "resume ") + C.w("35", f"{go}codex resume {r['session_id']}"))
        if not args.lean:
            if r["active"]:
                lines.append(C.w("90", "       ") + C.w("90", f"live in {running_in(r)}: close it there first, or `codex fork {r['session_id']}`"))
            lines.append(C.w("90", "clean  ") + f"{go}codex")
            for tp in tips(r):
                lines.append(C.w("33", "▲ " + tp))
        if (args.subagents or args.verbose) and sb:
            lines.append(C.w("90", "subagents" + ("" if args.subagents else " (latest 3, -s for all)")))
            for a in sb[: (None if args.subagents else 3)]:
                lines.append(f"  {C.w('33', '◐') if a['state'] == 'running' else C.w('90', '✓')} {pad(a['type'][:16], 16)} "
                             f"{clip(a['desc'], inner - 52)}  {C.w('90', short_model(a['model'])[:10] + ' ' + fmt(a['ctx']) + ' ctx ' + ago(a['mtime']))}")
        return panel(f"{i}  {ttl}", running_in(r), lines, W, "35" if r["active"] else "90")

    if not args.minimal:
        out.append("  " + badge_small("OK") + " nothing to do   " + badge_small("AMBER") + " context ≥85%, waiting on approval, or idle >1h   "
                   + badge_small("RED") + " context ≥95%")
    index = {}
    n = 0
    if args.show_live:
        if act and args.compact:
            ln = []
            for r in act:
                n += 1
                index[r["session_id"]] = n
                note(n, r)
                ln.append(f"{pad(str(n), 2, 'r')} {pad(badge_small(health(r)[0]), 7, 'r')} {pad(state_dot(r), 10)} {pad(clip(r['name'] or r['title'], 24), 24)} "
                          f"{pad(running_in(r)[:14], 14)} {pad(short_model(r['model'])[:10], 10)} {ctx_cell(r, 8)} {pad(ago(r['last_active']), 4, 'r')}")
                if r["session_id"] == expand:
                    ln += detail_lines(r, inner - 4, "    ")
            out += panel("LIVE SESSIONS", "minimal" if args.minimal else "compact", ln, W, "35")
        elif act:
            out.append(C.w("1;35", "LIVE SESSIONS") + C.w("90", "  a process is running; idle ones still hold memory"))
            for r in act:
                n += 1
                index[r["session_id"]] = n
                note(n, r)
                if n > 1:
                    out.append(C.w("90", "╌" * W))
                out += card(n, r)
        else:
            out += panel("LIVE SESSIONS", "", ["none running"], W, "35")
    if args.show_arc:
        if arc:
            ln = []
            for r in arc:
                n += 1
                index[r["session_id"]] = n
                note(n, r)
                ahl, awhy = health(r)
                ln.append(f"{pad(str(n), 3, 'r')} {pad(badge_small(ahl), 10)} {pad(clip(r['title'], inner - 64), max(10, inner - 64))} "
                          f"{pad(r['source'][:9], 9)} {pad(short_model(r['model'])[:10], 10)} {bar(ctx_pct(r), 6)} "
                          f"{pad(fmt(tok_total(r)), 7, 'r')} {pad(ago(r['last_active']), 4, 'r')}")
                if arc_prompt and r["session_id"] != expand:
                    ln.append("     " + C.w("90", "latest ") + clip(r["latest_prompt"], inner - 12))
                if r["session_id"] == expand:
                    ln += detail_lines(r, inner - 4)
                else:
                    ln.append(C.w("90", "     " + resume_cmd(r)))
                if awhy:
                    ln.append("     " + C.w(HCOL[ahl], "▲ " + " · ".join(awhy)))
            out.append("")
            out += panel("ARCHIVED / ENDED", f"last {args.days}d · newest {len(arc)} shown", ln, W, "90")
        else:
            out += panel("ARCHIVED / ENDED", "", [f"none in the last {args.days}d"], W, "90")
        if hidden:
            out.append(C.w("33", f"  {hidden} older archived chat(s) not shown: -n 0 for all, -n N for more, -d DAYS to widen"))
    out.append(C.w("90", "  ctx = last turn's input (cached included) vs the model's window · * = waiting on approval · -h for flags"))
    if not getattr(args, "tui", False):
        out.append(C.w("90", f"  view: {level_name(args.level)} (level {args.level}) · less: --level {max(0, args.level - 30)} · more: --level {min(100, args.level + 20)} · pick one: -i · full-screen: run without --no-tui"))
    return "\n".join(out)
