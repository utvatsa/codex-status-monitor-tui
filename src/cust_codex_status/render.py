"""Static output: panels, cards, badges and the full report (`render_ui`). Pure text, no I/O."""
import time

from . import config
from .health import ctx_pct, health, tips, warnings_for
from .tiles import tile_lines
from .util import ANSI, C, ago, bar, clip, fmt, home_rel, pad, running_in, short_model, term_width, until, vlen
from .views import level_name


def styled_title(title, accent="secondary"):
    """`CODEX ▸ usage limits` -> bold orchid CODEX, dim arrow, bold text; `3 ▸ chat name` -> a coral number first."""
    head, sep, rest = title.partition(" ▸ ")
    if not sep:
        return C.t("text", title, bold=True)
    return C.t("primary" if head == "CODEX" else accent, head, bold=True) + C.t("dim", " ▸ ") + C.t("text", rest, bold=True)


def panel(title, right, lines, width, tone="frame", mark="secondary"):
    """Heavy box: `┏━▍CODEX ▸ title ━━━ note ━┓`. A coral bar marks the title, the note sits dim on the right, lines are padded to fit."""
    inner = width - 4
    left = C.t(tone, "┏━") + C.t(mark, "▍") + styled_title(title, mark) + " "
    rt = " " + C.t("dim", right) + " " if right else ""
    fill = max(1, width - vlen(left) - vlen(rt) - 1 - (1 if rt else 0))
    out = [left + C.t(tone, "━" * fill) + rt + C.t(tone, ("━" if rt else "") + "┓")]
    for ln in lines:
        if vlen(ln) > inner:                       # last-resort guard: never break the frame
            ln = ANSI.sub("", ln)[: inner - 1] + "…"
        out.append(C.t(tone, "┃") + " " + pad(ln, inner) + " " + C.t(tone, "┃"))
    out.append(C.t(tone, "┗" + "━" * (width - 2) + "┛"))
    return out


# a chat's process state: not health, so the dots use the palette (orchid = idle, coral = busy), never green/amber/red
DOT = {"idle": ("●", "primary"), "busy": ("◆", "secondary"), "running?": ("◐", "secondary"), "ended": ("○", "dim")}


def state_dot(r):
    ch, tone = DOT.get(r["state"], ("○", "dim"))
    return C.t(tone, ch + " " + r["state"] + ("*" if r["waiting"] else ""))


HCOL = {"OK": "ok", "AMBER": "amber", "RED": "red"}


def badge_small(level):
    """`[OK]` without colour; with colour a pill: half-block ends in the level's colour around ink text on a solid block."""
    if not C.on:
        return f"[{level}]"
    return C.t(HCOL[level], "▐") + C.block(HCOL[level], level) + C.t(HCOL[level], "▌")


def badge_big(level):
    """Three rows, 9 columns wide: a rounded block in the level's colour with the level in the middle (a heavy outline without colour)."""
    if not C.on:
        return ["┏━━━━━━━┓", f"┃{level:^7}┃", "┗━━━━━━━┛"]
    t = HCOL[level]
    return [C.t(t, "▗" + "▄" * 7 + "▖"), C.t(t, "▐") + C.block(t, f"{level:^7}") + C.t(t, "▌"), C.t(t, "▝" + "▀" * 7 + "▘")]


def bar_pct(r, width=8):
    pct = ctx_pct(r)
    return f"{bar(pct, width)} {pct:>3}%"


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
    out = [C.t("dim", "folder ") + home_rel(r["cwd"] or "-"),
           C.t("dim", "id     ") + r["session_id"] + (C.t("dim", f"   pid {r['pid']}") if r["pid"] else ""),
           C.t("dim", "stats  ") + stats,
           C.t("dim", "first  ") + clip(r["first_prompt"], width - 8),
           C.t("dim", "latest ") + clip(r["latest_prompt"], width - 8),
           *resume_lines(r, width)]
    if r["active"]:
        out.append(C.t("dim", "       ") + C.t("dim", f"live in {running_in(r)}: close it there first, or `codex fork {r['session_id']}`"))
    out.append(C.t("dim", "clean  ") + clean_cmd(r))
    out += [C.t("amber", "▲ " + tp) for tp in tips(r)]
    return [indent + ln for ln in out]


def wrap_parts(text, width):
    """Split a ` · `-separated line into lines no wider than `width`, breaking only between parts."""
    out, cur = [], ""
    for part in text.split(" · "):
        if cur and len(cur) + 3 + len(part) > width:
            out.append(cur)
            cur = ""
        cur = cur + " · " + part if cur else part
    return out + [cur] if cur else out


def resume_lines(r, inner):
    """`resume cd <folder> && codex resume <id>`; on two lines (`&&` ends the first) when one would not fit."""
    cmd = resume_cmd(r)
    if len(cmd) + 7 <= inner or " && " not in cmd:
        return [C.t("dim", "resume ") + C.t("primary", cmd)]
    first, second = cmd.split(" && ", 1)
    return [C.t("dim", "resume ") + C.t("primary", first + " &&"), C.t("dim", "       ") + C.t("primary", second)]


def render_ui(rows, acct, usage, args, hidden=0, items=None):
    """The whole report as text. `items`, when given, is filled with one dict per selectable chat in display order
    (the TUI selects by these; `args.expand` = a session id whose collapsed row should show its details)."""
    W = max(60, min(term_width(), 118))
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

    # masthead: title pill and rule, who and what is live, the six metric tiles, the mix line, health counts
    cnt = {k: sum(1 for r in act if health(r)[0] == k) for k in HCOL}
    stamp = time.strftime("%a %d %b %Y %H:%M:%S") + "  read-only"
    pill = C.block("primary", " CODEX ") + C.t("dim", "▸ ") + C.t("text", "status", bold=True) + " "
    out.append(pill + C.t("frame", "━" * max(1, W - vlen(pill) - len(stamp) - 2)) + " " + C.t("dim", stamp))
    plan = f"{acct.get('plan') or '?'} · {acct.get('tier') or '?'}"
    who = "  " + C.t("text", acct.get("email") or "?", bold=True) + C.t("dim", "   " + plan)
    live = C.t("dim", f"{len(act)} live · {sum(r['mem_mb'] or 0 for r in act)}MB · {fmt(toks(act))} tokens live"
               + (f" · {len(arc)} archived · {fmt(toks(arc))} tokens" if args.show_arc else ""))
    out += [who + "   " + live] if vlen(who) + 3 + vlen(live) <= W else [who, "  " + live]
    if args.account:
        out += ["  " + C.t("dim", f"{k:17}") + str(v) for k, v in account_fields(acct)]
    tl, metrics = tile_lines(rows, limits, cnt, W - 2, args.minimal or args.compact)
    out += ["  " + ln for ln in tl]
    out.append("  " + C.t("dim", "live health  ") + "   ".join(f"{badge_small(k)} {cnt[k]}" for k in HCOL))
    out.append("")

    # usage
    ul = []
    age = (time.time() * 1000 - usage.get("fetchedAtMs", 0)) / 1000 if usage else None
    if limits:
        for l in limits:
            scope = ((l.get("scope") or {}).get("model") or {}).get("display_name")
            label = l.get("label") or {"session": "5-hour session", "weekly_all": "weekly · all models", "weekly_scoped": "weekly"}.get(l["kind"], l["kind"])
            label += f" · {scope}" if scope else ""
            pct = l.get("percent") or 0
            ul.append(f"{pad(label, 20)} {bar(pct, 24 if inner >= 90 else 12)} {pct:>3}%   resets {until(l.get('resets_at'))}"
                      + (C.t("secondary", "   ◂ busiest") if l.get("is_active") else ""))
        for k, v in u.items():
            if isinstance(v, dict) and v.get("limit_dollars") and k != "limits":
                ul.append(f"{pad('credit pool', 20)} ${v.get('used_dollars')} of ${v.get('limit_dollars')} used · {k} · resets {until(v.get('resets_at'))}")
        stale = age and age > config.alert_rules()["time"]["limits_stale_min"] * 60
        ul.append(C.t("dim", f"as of the last Codex turn, {ago(time.time() - age)} ago" + (" · STALE, run a prompt in Codex for live numbers" if stale else "")))
    else:
        ul.append("no usage data yet; limits are read from the latest Codex turn")
    if not args.minimal:
        out += panel("CODEX ▸ usage limits", "", ul, W)

    warn = warnings_for(rows, limits)
    if warn and not args.minimal:
        out += panel("CODEX ▸ attention", "", [C.t("amber", "▲ " + w) for w in warn], W, "amber", "amber")

    def card(i, r):
        sb = r["subagents"]
        nr = sum(1 for a in sb if a["state"] == "running")
        t = r["tokens"]
        ttl = clip((r["name"] + " · " if r["name"] and r["active"] else "") + r["title"], inner - 40)
        hl, why = health(r)
        narrow = inner < 92                              # too tight for the big badge: small badge, long lines wrap
        last = f"last {ago(r['last_active'])}" + (f" · up {r['up']}" if r["active"] and r["up"] else "")
        state = f"{pad(state_dot(r), 10)} {pad(short_model(r['model'])[:12], 12)} {ctx_cell(r)}" + ("" if narrow else "   " + C.t("dim", last))
        stats = tok_stats(r)
        if sb:
            stats += f" · subagents {nr}/{len(sb)}"
        if r["active"] and r["mem_mb"]:
            stats += f" · {r['mem_mb']}MB"
        reason = C.t(HCOL[hl], " · ".join(why)) if why else C.t("dim", "nothing needs attention")
        if narrow:
            stats = last + " · " + stats
        if args.lean or narrow:
            lines = [f"{badge_small(hl)} {state}"] + [C.t("dim", ln) for ln in wrap_parts(stats, inner)] + ([reason] if why else [])
        else:
            b = badge_big(hl)
            lines = [f"{b[0]}  {state}", f"{b[1]}  {reason}", f"{b[2]}  " + C.t("dim", stats)]
        if not args.lean:
            lines.append(C.t("dim", "folder ") + home_rel(r["cwd"] or "-"))
            lines.append(C.t("dim", "id     ") + r["session_id"] + (C.t("dim", f"   pid {r['pid']}") if r["pid"] else ""))
        if not args.no_prompts and not args.lean:
            lines.append(C.t("dim", "first  ") + clip(r["first_prompt"], inner - 8))
            lines.append(C.t("dim", "latest ") + clip(r["latest_prompt"], inner - 8))
        go = f"cd {home_rel(r['cwd'])} && " if r["cwd"] else ""
        lines += resume_lines(r, inner)
        if not args.lean:
            if r["active"]:
                lines.append(C.t("dim", "       ") + C.t("dim", f"live in {running_in(r)}: close it there first, or `codex fork {r['session_id']}`"))
            lines.append(C.t("dim", "clean  ") + f"{go}codex")
            for tp in tips(r):
                lines.append(C.t("amber", "▲ " + tp))
        if (args.subagents or args.verbose) and sb:
            lines.append(C.t("dim", "subagents" + ("" if args.subagents else " (latest 3, -s for all)")))
            for a in sb[: (None if args.subagents else 3)]:
                lines.append(f"  {C.t('secondary', '◐') if a['state'] == 'running' else C.t('dim', '✓')} {pad(a['type'][:16], 16)} "
                             f"{clip(a['desc'], inner - 52)}  {C.t('dim', short_model(a['model'])[:10] + ' ' + fmt(a['ctx']) + ' ctx ' + ago(a['mtime']))}")
        return panel(f"{i} ▸ {ttl}", running_in(r), lines, W, "frame" if r["active"] else "faint", "secondary" if r["active"] else "faint")

    if not args.minimal:
        legend = ["  " + badge_small("OK") + " nothing to do   ", badge_small("AMBER") + " context ≥85%, waiting on approval, or idle >1h   ", badge_small("RED") + " context ≥95%"]
        out += ["".join(legend)] if W >= 108 else ["  " + legend[0].strip() + "   " + legend[2], "  " + legend[1].strip()]
    index = {}
    n = 0
    if args.show_live:
        if act and args.compact:
            ln = []
            for r in act:
                n += 1
                index[r["session_id"]] = n
                note(n, r)
                head = f"{pad(str(n), 2, 'r')} {pad(badge_small(health(r)[0]), 7, 'r')} {pad(state_dot(r), 10)} "
                tail = f"{ctx_cell(r, 8) if inner >= 96 else bar_pct(r, 8)} {pad(ago(r['last_active']), 4, 'r')}"
                if inner >= 66:
                    tail = f"{pad(short_model(r['model'])[:10], 10)} " + tail
                if inner >= 96:
                    tail = f"{pad(running_in(r)[:14], 14)} " + tail
                room = min(24, max(8, inner - vlen(head) - vlen(tail) - 1))
                ln.append(f"{head}{pad(clip(r['name'] or r['title'], room), room)} {tail}")
                if r["session_id"] == expand:
                    ln += detail_lines(r, inner - 4, "    ")
            out += panel("CODEX ▸ live threads", "minimal" if args.minimal else "compact", ln, W)
        elif act:
            out.append(C.t("secondary", "▍") + styled_title("CODEX ▸ live threads") + (C.t("dim", "  a process is running; idle ones still hold memory") if W >= 80 else ""))
            for r in act:
                n += 1
                index[r["session_id"]] = n
                note(n, r)
                if n > 1:
                    out.append(C.t("faint", "┄" * W))
                out += card(n, r)
        else:
            out += panel("CODEX ▸ live threads", "", ["none running"], W)
    if args.show_arc:
        if arc:
            ln = []
            for r in arc:
                n += 1
                index[r["session_id"]] = n
                note(n, r)
                ahl, awhy = health(r)
                head = f"{pad(str(n), 3, 'r')} {pad(badge_small(ahl), 10)} "
                tail = f"{bar(ctx_pct(r), 6)} {pad(fmt(tok_total(r)), 7, 'r')} {pad(ago(r['last_active']), 4, 'r')}"
                if inner >= 84:
                    tail = f"{pad(r['source'][:9], 9)} {pad(short_model(r['model'])[:10], 10)} " + tail
                room = max(10, inner - vlen(head) - vlen(tail) - 1)
                ln.append(f"{head}{pad(clip(r['title'], room), room)} {tail}")
                if arc_prompt and r["session_id"] != expand:
                    ln.append("     " + C.t("dim", "latest ") + clip(r["latest_prompt"], inner - 12))
                if r["session_id"] == expand:
                    ln += detail_lines(r, inner - 4)
                else:
                    ln.append(C.t("dim", "     " + resume_cmd(r)))
                if awhy:
                    ln.append("     " + C.t(HCOL[ahl], "▲ " + " · ".join(awhy)))
            out.append("")
            out += panel("CODEX ▸ archived threads", f"last {args.days}d · newest {len(arc)} shown", ln, W, "faint", "faint")
        else:
            out += panel("CODEX ▸ archived threads", "", [f"none in the last {args.days}d"], W, "faint", "faint")
        if hidden:
            out += [C.t("secondary", "  " + ln) for ln in wrap_parts(f"{hidden} older archived chat(s) not shown: -n 0 for all, -n N for more, -d DAYS to widen".replace(", ", " · "), W - 2)]
    out += [C.t("dim", "  " + ln) for ln in wrap_parts("ctx = last turn's input (cached included) vs the model's window · * = waiting on approval · -h for flags", W - 2)]
    if not getattr(args, "tui", False):
        out += [C.t("dim", "  " + ln) for ln in wrap_parts(f"view: {level_name(args.level)} (level {args.level}) · less: --level {max(0, args.level - 30)} · more: --level {min(100, args.level + 20)} · pick one: -i · full-screen: run without --no-tui", W - 2)]
    return "\n".join(out)
