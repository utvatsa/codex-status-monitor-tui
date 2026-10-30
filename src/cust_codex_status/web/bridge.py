"""The bridge between the existing pipeline and the browser: `snapshot()` turns one `report.fetch()` result into plain JSON,
and `Hub` hands the latest one to every open page.

The browser never reads the disk. Whoever owns the data (the TUI, or the headless `--web` loop) fetches it exactly as before
and calls `hub.publish()`; health levels, reasons, tips and all number formatting come from the same functions the text
report uses, so the two views cannot disagree."""
import json
import threading
import time

from .. import config
from ..footprint import REGENERABLE, advice, footprint, mb
from ..health import ctx_levels, ctx_pct, health, system_alerts, tips, waiting_for, warnings_for
from ..render import account_fields, clean_cmd, resume_cmd
from ..util import ago, fmt, running_in, short_model, until
from ..views import DEFAULT_LEVEL, LEVEL_REPS, LEVELS


def _limits(usage):
    u = usage.get("utilization") or {}
    out = []
    for l in u.get("limits") or []:
        scope = ((l.get("scope") or {}).get("model") or {}).get("display_name")
        label = l.get("label") or {"session": "5-hour session", "weekly_all": "weekly", "weekly_scoped": "weekly"}.get(l.get("kind"), l.get("kind"))
        out.append(dict(label=label + (f" · {scope}" if scope else ""), pct=l.get("percent") or 0,
                        resets=until(l.get("resets_at")).replace("in ", ""), binding=bool(l.get("is_active"))))
    pools = [f"${v.get('used_dollars')} of ${v.get('limit_dollars')} used · {k} · resets {until(v.get('resets_at'))}"
             for k, v in u.items() if isinstance(v, dict) and v.get("limit_dollars") and k != "limits"]
    age = (time.time() * 1000 - usage.get("fetchedAtMs", 0)) / 1000 if usage else None
    return dict(limits=out, pools=pools, cached_ago=ago(time.time() - age) if age is not None else None, stale=bool(age and age > 900))


def _window(r, pct):
    """The window the chat is judged against, where that came from, its alert levels in tokens, and (when it is only a guess and the
    chat is nearly full on it) the action that fixes it: a config write the page can ask for, or this command."""
    amber, red = ctx_levels(r)
    model = short_model(r["model"])
    offer = None
    if r.get("window_source", "guess") == "guess" and r["window"] == config.WINDOW_SMALL and pct >= amber and model != "-":
        offer = dict(sid=r["session_id"], size="1m", amber=config.alert_rules()["context"]["1m"][0], red=config.alert_rules()["context"]["1m"][1],
                     command=f"cust-codex-status --set-window {config.chat_key(r['session_id'])} 1m")
    return dict(window_tokens=r["window"], window_source=r.get("window_source", "guess"), levels_custom=bool(config.chat_levels(r.get("session_id") or "")),
                clear_command=f"cust-codex-status --clear-window {config.chat_key(r.get('session_id') or '')}", ctx_amber_pct=amber, ctx_red_pct=red,
                ctx_amber=fmt(r["window"] * amber // 100), ctx_red=fmt(r["window"] * red // 100), window_offer=offer)


def _files(r):
    """The chat's footprint on disk and the advice that follows from it (cheap: cached per chat)."""
    if not r.get("transcript"):
        return dict(files=None, advice=[])
    fp = footprint(r["session_id"], r["transcript"])
    return dict(files=dict(total_mb=mb(fp["total"]), parts=[[k, mb(v)] for k, v in sorted(fp["parts"].items(), key=lambda kv: -kv[1])]),
                advice=advice(r, fp))


def _total(t):
    """All tokens a chat has used: uncached input + cached input + output (reasoning is already inside output). Codex has no price table."""
    return (t.get("input") or 0) + (t.get("cache_read") or 0) + (t.get("output") or 0)


def _session(r):
    hl, why = health(r)
    t = r["tokens"]
    pct = ctx_pct(r)
    return dict(**_window(r, pct), **_files(r), waiting_for=waiting_for(r),

        sid=r["session_id"], active=r["active"], name=r["name"], title=r["title"], label=r["name"] or r["title"],
        state=r["state"], waiting=r["waiting"], health=hl, why=why, tips=tips(r),
        model=short_model(r["model"]), ctx_pct=pct, ctx=fmt(r["ctx"]), window=fmt(r["window"]),
        maybe_1m=r["window"] == 200_000 and r.get("window_source", "guess") == "guess" and pct >= ctx_levels(r)[0],
        turns=t["turns"], inp=fmt(t["input"]), out=fmt(t["output"]), cache_r=fmt(t["cache_read"]), reasoning=fmt(t.get("reasoning", 0)),
        tokens=fmt(_total(t)), cost=("$%.2f" % r["cost"]) if r.get("cost") else "-", branch=r.get("branch"), entry=r.get("entry"),
        mem_mb=r["mem_mb"], pid=r["pid"], folder=r["cwd"] or "-", running_in=running_in(r), source=r["source"],
        last=ago(r["last_active"]), up=r["up"] if r["active"] else None,
        first_prompt=r["first_prompt"], latest_prompt=r["latest_prompt"], resume=resume_cmd(r), clean=clean_cmd(r),
        subagents=[dict(code=a["id"], type=a["type"], desc=a["desc"], model=short_model(a["model"]), ctx=fmt(a["ctx"]), ago=ago(a["mtime"]),
                        turns=a["tokens"]["turns"], out=fmt(a["tokens"]["output"]), phase=a.get("phase", "active" if a["state"] == "running" else "done"),
                        running=a["state"] == "running") for a in r["subagents"]])


def _machine(rows, sessions):
    """Machine-level alerts, with what the user can do about them: the disk alert says how much ended chats could free."""
    out = system_alerts(rows)
    for a in out:
        if a["kind"] == "disk":
            fix = [s for s in sessions if any(x["kind"] == "delete-scratch" for x in s["advice"])]
            a["reclaim_mb"] = round(sum(sum(mb_ for k, mb_ in s["files"]["parts"] if k in REGENERABLE) for s in fix), 1)
            a["reclaim_chats"] = [s["sid"] for s in fix]
    return out


def snapshot(data, opts, source="tui", with_arc=False):
    """One report.fetch() result -> a JSON-ready dict. Every row is included; the page picks what to show, like the renderer does."""
    rows, hidden, acct, usage = data
    act = [r for r in rows if r["active"]]
    arc = [r for r in rows if not r["active"]]
    cost = lambda rs: round(sum(r.get("cost") or 0 for r in rs), 2)
    toks = lambda rs: sum(_total(r["tokens"]) for r in rs)
    u = usage.get("utilization") or {}
    sessions = [_session(r) for r in rows]
    return dict(
        generated=time.time(), clock=time.strftime("%a %d %b %Y %H:%M:%S"), source=source,
        account=dict(email=acct.get("email"), plan=acct.get("plan"), tier=acct.get("tier"),
                     fields=[[k, str(v) if v is not None else "-"] for k, v in account_fields(acct)] if acct else []),
        usage=_limits(usage),
        warnings=warnings_for(rows, u.get("limits") or []), system=_machine(rows, sessions),
        totals=dict(live=len(act), mem_mb=sum(r["mem_mb"] or 0 for r in act), live_cost=cost(act), live_tokens=toks(act), archived=len(arc), arc_cost=cost(arc), arc_tokens=toks(arc),
                    health={k: sum(1 for r in act if health(r)[0] == k) for k in ("OK", "AMBER", "RED")}),
        sessions=sessions,
        view=dict(level=getattr(opts, "level", DEFAULT_LEVEL), levels=[[lo, nm] for lo, nm in LEVELS], reps=LEVEL_REPS,
                  show_live=getattr(opts, "show_live", True), has_arc=bool(getattr(opts, "show_arc", False) or with_arc),
                  days=getattr(opts, "days", 7), project=getattr(opts, "project", None), hidden=hidden,
                  ctx_amber=config.alert_rules()["context"]["200k"][0], ctx_red=config.alert_rules()["context"]["200k"][1],
                  ctx_rules=config.alert_rules()["context"]))


class Hub:
    """Latest snapshot + who is watching. Thread-safe: the data owner publishes, the HTTP threads wait for news.

    The page can ask for a refresh (`request_refresh`); the owner picks it up with `take_refresh()` and fetches as usual,
    so even a browser click goes through the one pipeline."""

    def __init__(self, source="tui"):
        self.source = source
        self.cond = threading.Condition()
        self.version = 0
        self.payload = None                 # JSON bytes of the latest snapshot
        self.want_arc = False               # a page asked for archived chats: the owner reads them from now on
        self.closed = False
        self.clients = 0                    # open live connections (Server-Sent Events)
        self.last_seen = time.time()        # last time a page was connected or asked for anything
        self._refresh = threading.Event()

    def publish(self, data, opts, with_arc=False):
        body = json.dumps(snapshot(data, opts, self.source, with_arc), default=str).encode()
        with self.cond:
            self.version += 1
            self.payload = body
            self.cond.notify_all()

    def latest(self):
        with self.cond:
            return self.version, self.payload

    def wait(self, after, timeout):
        """Block until a snapshot newer than `after` exists (or timeout, or close): (version, payload or None)."""
        with self.cond:
            self.cond.wait_for(lambda: self.closed or (self.version > after and self.payload is not None), timeout)
            if self.closed or self.version <= after:
                return self.version, None
            return self.version, self.payload

    def request_refresh(self, archived=None):
        if archived:
            self.want_arc = True
        self._refresh.set()

    def take_refresh(self):
        """True once per refresh request (the owner then re-reads the disk and publishes)."""
        if self._refresh.is_set():
            self._refresh.clear()
            return True
        return False

    def touch(self, delta=0):
        with self.cond:
            self.clients += delta
            self.last_seen = time.time()

    def idle_for(self):
        with self.cond:
            return 0.0 if self.clients > 0 else time.time() - self.last_seen

    def close(self):
        with self.cond:
            self.closed = True
            self.cond.notify_all()
