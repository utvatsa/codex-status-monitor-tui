"""Glue between the data layer and the renderer: one call each for the text report and the raw JSON."""
from .data import account, collect
from .render import render_ui


def fetch(opts, with_arc=False):
    """Read everything once: (rows, hidden, account, usage). `with_arc` also reads archived chats when the view does not
    show them (the web view can, and it shares this data); the renderer only shows what `opts` asks for."""
    rows, hidden = collect(days=opts.days, project=opts.project, show_live=opts.show_live, show_arc=opts.show_arc or with_arc, limit=opts.n)
    acct, usage = account()
    return rows, hidden, acct, usage


def draw(opts, data):
    """Render already-fetched data: (text, items). The TUI re-draws from the same data when only the view changes."""
    rows, hidden, acct, usage = data
    items = []
    return render_ui(rows, acct, usage, opts, hidden, items), items


def text(opts):
    return draw(opts, fetch(opts))[0]


def raw(opts):
    rows, _, acct, usage = fetch(opts)
    return dict(account=acct, usage=usage.get("utilization"), usage_fetched_at_ms=usage.get("fetchedAtMs"), sessions=rows)
