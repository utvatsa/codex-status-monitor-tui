"""Full-screen interactive view (stdlib curses): a menu-like list of chats.

Two modes. NAVIGATE: ↑↓ move a highlighted cursor over the chats. SELECTED: Enter locks the chat (green), collapsed rows
expand with their details and the footer switches to that chat's actions; b or Esc goes back to NAVIGATE. In NAVIGATE,
Esc twice (or q) quits.

The pure helpers (parsing, item spans, scrolling, footer layout, Esc logic, clipboard) sit at the top and need no
terminal, so they are unit-tested. `tui()` is the thin curses loop on top of them."""
import os
import re
import subprocess
import time

from . import report
from .config import web_enabled
from .util import C, clip
from .views import LEVELS, LEVEL_REPS, apply_level, level_name

SGR = re.compile(r"\x1b\[([0-9;]*)m")
ANSI_FG = {30: 0, 31: 1, 32: 2, 33: 3, 34: 4, 35: 5, 36: 6, 37: 7}
CARD = re.compile(r"╭─ \d+ ")
ROW = re.compile(r"│\s+\d+\s+\[?\s?(?:OK|AMBER|RED)\b")      # compact live row / archived row (badge with or without colour)
GUTTER = 2
ESC_WINDOW = 3.0                                              # seconds in which a second Esc quits


def plain(line):
    return SGR.sub("", line)


def parse_ansi(line):
    """ANSI line -> [(text, fg, bg, bold, dim)]; fg and bg are 0-7 or None."""
    out, pos, bold, dim, fg, bg = [], 0, False, False, None, None
    for m in SGR.finditer(line):
        if m.start() > pos:
            out.append((line[pos:m.start()], fg, bg, bold, dim))
        for c in (int(x) if x else 0 for x in m.group(1).split(";")):
            if c == 0:
                bold, dim, fg, bg = False, False, None, None
            elif c == 1:
                bold = True
            elif c == 90:
                dim, fg = True, None
            elif c == 97:
                fg = 7
            elif 40 <= c <= 47:
                bg = c - 40
            elif c in ANSI_FG:
                fg = ANSI_FG[c]
        pos = m.end()
    if pos < len(line):
        out.append((line[pos:], fg, bg, bold, dim))
    return out


def item_spans(lines):
    """[(first_line, last_line)] of every selectable chat, in display order (a card, a compact row, an archived row)."""
    starts = [i for i, ln in enumerate(lines) if CARD.match(plain(ln)) or ROW.match(plain(ln))]
    spans = []
    for k, st in enumerate(starts):
        limit = starts[k + 1] - 1 if k + 1 < len(starts) else len(lines) - 1
        end = st
        if CARD.match(plain(lines[st])):
            end = limit
        else:
            while end < limit and not plain(lines[end + 1]).startswith("╰"):
                end += 1
        spans.append((st, end))
    return spans


def item_at(spans, line):
    """Index of the item whose lines include `line`, or None."""
    for i, (a, b) in enumerate(spans):
        if a <= line <= b:
            return i
    return None


def top_for_span(top, start, end, body):
    """Scroll the least needed so the whole item is visible (or its first line at the top if it is taller than the screen)."""
    if end - start + 1 > body or start < top:
        return start
    if end >= top + body:
        return end - body + 1
    return top


def step_level(level, key):
    """New level for a TUI key: '1'-'5' jump to a view, '+'/'-' step to the next/previous one."""
    names = [lo for lo, _ in LEVELS]
    i = names.index(max(lo for lo in names if lo <= level))
    if key in "12345":
        i = int(key) - 1
    else:
        i = max(0, min(len(LEVELS) - 1, i + (1 if key in "+=" else -1)))
    return LEVEL_REPS[i]


def step_interval(sec, up):
    if up:
        return min(300, sec + 1 if sec < 10 else sec + 5)
    return max(1, sec - 1 if sec <= 10 else sec - 5)


def esc_action(selected, last_esc, now):
    """What an Esc press does: 'back' (SELECTED -> NAVIGATE), 'warn' (first Esc in NAVIGATE), 'quit' (second one in time)."""
    if selected:
        return "back"
    return "quit" if last_esc is not None and now - last_esc <= ESC_WINDOW else "warn"


# footer: (key label, description, key code a click sends or None, mark). The short list is the everyday keys; `m` swaps in all of them.
def help_items(selected, level, interval, more=False):
    view = f"view: {level_name(level)}"
    if selected:
        major = [("b / Esc", "◂ BACK to the menu", ord("b"), "back"),
                 ("⏎ / y", "copy RESUME command", 10, ""),
                 ("i", "copy session id", ord("i"), ""),
                 ("f", "copy fresh-chat command", ord("f"), ""),
                 ("↑ ↓", "select another chat", None, ""),
                 ("+ / -", view, ord("+"), ""),
                 ("q", "quit", ord("q"), "")]
    else:
        major = [("⏎", "SELECT the highlighted chat", 10, "main"),
                 ("↑ ↓ / Tab", "move the highlight", None, ""),
                 ("+ / -", view, ord("+"), ""),
                 ("a", "archived chats on/off", ord("a"), ""),
                 ("Esc Esc / q", "quit", ord("q"), "")]
    if not more:
        return major + [("m", "MORE keys", ord("m"), "")]
    extra = [("⇧↑ ⇧↓ / PgUp PgDn", "scroll a page", ord(" "), ""),
             ("j k / g G / wheel", "scroll a line / top, bottom", None, ""),
             ("1-5", "jump to a view level", None, ""),
             ("t", "archived prompt line on/off", ord("t"), ""),
             ("c", "compact rows on/off", ord("c"), ""),
             ("p", "prompts on/off", ord("p"), ""),
             ("v", "subagents on/off", ord("v"), ""),
             ("[ ]", f"refresh every {interval}s", None, ""),
             ("r", "refresh now", ord("r"), ""),
             ("w / W", "web view: open in browser / stop", ord("w"), ""),
             ("Ctrl-L", "repaint the screen", None, ""),
             ("a", "archived chats on/off", ord("a"), "")]
    have = {k for k, _, _, _ in major}
    return major + [e for e in extra if e[0] not in have] + [("m", "fewer keys (any key also closes this)", ord("m"), "")]


def layout_help(items, width, max_rows):
    """Place the key helpers in a grid that fits `width` and `max_rows`: [(row, col_x, item)] and the rows used.
    Wide screens get a roomy grid (extra blank row between rows when it fits), narrow ones fall back to one per line."""
    if not items:
        return [], 0
    need = max(len(k) + 2 + 2 + len(d) for k, d, _, _ in items)
    for gap in (6, 3, 2):
        colw = need + gap
        cols = max(1, (width - 1) // colw)
        rows = -(-len(items) // cols)
        if rows <= max_rows:
            break
    cols = max(1, min(cols, len(items)))
    shown = items[: cols * max_rows]
    rows = -(-len(shown) // cols)
    step = 2 if rows * 2 - 1 <= max_rows else 1          # blank line between rows when there is room
    placed = [((i // cols) * step, (i % cols) * colw, it) for i, it in enumerate(shown)]
    return placed, (rows - 1) * step + 1


def web_bar(enabled, url=None, clients=0, idle=60):
    """The top line: [(text, key code a click sends or None, kind)]. kind: 'tag' (the WEB label), 'key' (a key cap), '' (text)."""
    if not enabled:
        return []
    if not url:
        return [(" WEB ", None, "tag"), ("  off · the same view in your browser, served locally  ", None, ""),
                (" w ", ord("w"), "key"), (" open in browser", ord("w"), "")]
    seen = f"{clients} browser{'s' if clients != 1 else ''} open" if clients else ("no browser yet · stops after %ds without one" % idle if idle else "no browser yet")
    return [(" WEB ● ", None, "on"), (f" {url} ", ord("w"), "url"), (f"  {seen}  ", None, ""),
            (" w ", ord("w"), "key"), (" open again  ", ord("w"), ""), (" W ", ord("W"), "key"), (" stop server", ord("W"), "")]


def copy_text(text, what, label="this chat"):
    """Put `text` on the clipboard (the tool's only write) and return the message to show."""
    if not text:
        return f"nothing to copy ({what})"
    try:
        subprocess.run(["pbcopy"], input=text.encode(), check=True, timeout=3)
        return f"✔ copied the {what} of {label}: {clip(text, 70)}"
    except (OSError, subprocess.SubprocessError):
        return "copy failed (pbcopy missing?)"


def copy_resume(cmd, label="this chat"):
    msg = copy_text(cmd, "RESUME command", label)
    return msg + "  (paste it in a terminal to reopen the chat)" if msg.startswith("✔") else msg


def tui(args):
    import curses

    os.environ.setdefault("ESCDELAY", "25")                  # so a lone Esc is not held back waiting for an escape sequence

    def run(scr, stop):
        curses.curs_set(0)
        curses.use_default_colors()
        for i in range(8):
            curses.init_pair(i + 1, i, -1)
            for f in range(8):
                curses.init_pair(10 + i * 8 + f, f, i)      # fg f on background i (health badges, selection)

        def pair(fg, bg):
            return curses.color_pair(10 + bg * 8 + fg)

        def attr_of(fg, bg, bold, dim):
            a = pair(fg or 0, bg) if bg is not None else curses.color_pair(0 if fg is None else fg + 1)
            return a | (curses.A_BOLD if bold else 0) | (curses.A_DIM if dim else 0)

        NAV_ATTR = pair(0, 5) | curses.A_BOLD                # black on magenta: the cursor
        SEL_ATTR = pair(0, 2) | curses.A_BOLD                # black on green: the locked selection
        KEY_ATTR = pair(0, 7) | curses.A_BOLD                # key caps in the footer
        BACK_ATTR = pair(0, 3) | curses.A_BOLD               # the BACK button
        WEB_ON = pair(0, 2) | curses.A_BOLD                  # the WEB tag while the server runs
        URL_ATTR = curses.color_pair(7) | curses.A_BOLD | curses.A_UNDERLINE

        C.on = True
        C.margin = GUTTER
        st = dict(top=0, cur=None, locked=False, interval=args.watch or 5, body=10, more=False, msg="", last_esc=None, data=None, hit=[],
                  arc_read=False, web=None, hub=None)
        web_on = web_enabled()
        view = dict(lines=[], items=[], spans=[])
        prev, last = None, 0.0

        def redraw(refetch=False):
            """Rebuild the text: re-read the disk only when asked, otherwise re-render the data we already have."""
            nonlocal prev, last
            if args.show_arc and not st["arc_read"]:
                refetch = True                                   # archived chats were turned on but never read
            if refetch or st["data"] is None:
                hub = st["hub"] if st["web"] and st["web"].running else None
                arc = bool(hub and hub.want_arc)
                st["data"] = report.fetch(args, with_arc=arc)
                st["arc_read"] = args.show_arc or arc
                last = time.time()
                if hub:
                    hub.publish(st["data"], args, with_arc=arc)  # the bridge: the browser gets exactly what we just read
            args.expand = st["cur"] if st["locked"] else None
            text, items = report.draw(args, st["data"])
            raw = text.split("\n")
            mark = refetch and prev is not None                  # yellow bar on lines that changed since the last disk read
            view["lines"] = [C.w("1;33", "▌") + ln[1:] if mark and ln.startswith("  ") and plain(ln) not in prev else ln for ln in raw]
            if refetch:
                prev = {plain(ln) for ln in raw}
            view["items"] = items
            view["spans"] = item_spans(view["lines"])
            if len(view["spans"]) != len(items):               # parse mismatch: keep what lines up, never crash
                n = min(len(view["spans"]), len(items))
                view["spans"], view["items"] = view["spans"][:n], items[:n]
            sids = [it["sid"] for it in view["items"]]
            if st["cur"] not in sids:
                st["cur"], st["locked"] = (sids[0] if sids else None), False
                args.expand = None

        def idx():
            return next((i for i, it in enumerate(view["items"]) if it["sid"] == st["cur"]), None)

        def label():
            i = idx()
            return f"#{view['items'][i]['n']} {view['items'][i]['name']}" if i is not None else "this chat"

        def show(i, body):
            a, b = view["spans"][i]
            st["top"] = top_for_span(st["top"], a, b, body)

        def move(delta, body):
            i = idx()
            if i is None or not view["items"]:
                st["top"] += delta
                return
            j = i + delta
            if 0 <= j < len(view["items"]):
                st["cur"] = view["items"][j]["sid"]
                if st["locked"]:
                    redraw()
                show(idx(), body)
            else:
                st["top"] += delta                              # past the ends: keep scrolling

        def select(on):
            st["locked"] = on
            redraw()
            if on and idx() is not None:
                show(idx(), st["body"])

        def level_key(ch):
            args.level = step_level(args.level, ch)
            apply_level(args)
            redraw()
            st["msg"] = f"view: {level_name(args.level)} (level {args.level})"

        def toggle(name):
            setattr(args, name, not getattr(args, name))
            redraw()

        def web_start():
            """`w`: start the local web server (first press) or open the page again; the browser gets the data we already have."""
            if not web_on:
                st["msg"] = "the web add-on is off: cust-codex-status --set-web on"
                return
            from . import web
            if st["web"] and st["web"].running:
                ok = web.open_url(st["web"].url)
                st["msg"] = f"opened {st['web'].url} in your browser" if ok else f"could not open a browser; open {st['web'].url} yourself"
                return
            try:
                st["web"], st["hub"] = web.start("tui", port=getattr(args, "port", 8765) or 0, idle=getattr(args, "web_idle", 60),
                                               open_browser=not getattr(args, "no_open", False))
            except OSError as e:
                st["msg"] = f"web server failed to start: {e}"
                return
            stop.append(st["web"])
            st["hub"].publish(st["data"], args, with_arc=st["arc_read"])
            st["msg"] = (f"web view on {st['web'].url} (read-only, local only; W stops it)" if st["web"].opened is not False
                         else f"web view on {st['web'].url}: could not open a browser, open that address yourself (W stops it)")

        def web_stop(reason="stopped with W"):
            if st["web"]:
                st["web"].stop(reason)
            st["web"], st["hub"] = None, None
            st["msg"] = f"web server stopped ({reason})"

        curses.mousemask(curses.BUTTON1_CLICKED | curses.BUTTON1_PRESSED | getattr(curses, "BUTTON4_PRESSED", 0) | getattr(curses, "BUTTON5_PRESSED", 0))
        scr.keypad(True)
        scr.timeout(500)
        redraw(refetch=True)
        st["cur"] = view["items"][0]["sid"] if view["items"] else None
        if getattr(args, "web", False):
            web_start()
        pending = None                                           # a key code injected by a footer click
        while True:
            h, w = scr.getmaxyx()
            items_help = help_items(st["locked"], args.level, st["interval"], st["more"])
            cap = max(2, h // 2 if st["more"] else h // 3)
            placed, used = layout_help(items_help, w, cap)
            used = max(used, layout_help(help_items(not st["locked"], args.level, st["interval"], st["more"]), w, cap)[1])   # footer height stays put between modes
            foot = 1 + used + (1 if used else 0)                  # mode bar + blank + grid
            if st["web"] and not st["web"].running:              # it stopped itself (no browser for a minute)
                web_stop(st["web"].reason)
            bar = web_bar(web_on, st["web"].url if st["web"] else None, st["hub"].clients if st["hub"] else 0, getattr(args, "web_idle", 60))
            tb = 1 if bar else 0                                 # rows the web bar takes at the top
            body = st["body"] = max(1, h - foot - tb)
            lines, spans = view["lines"], view["spans"]
            st["top"] = max(0, min(st["top"], max(0, len(lines) - body)))
            cur_i = idx()
            cur_span = spans[cur_i] if cur_i is not None else None
            hi = SEL_ATTR if st["locked"] else NAV_ATTR
            scr.erase()
            st["hit"] = []
            x = 0
            for txt, code, kind in bar:
                a = {"tag": KEY_ATTR, "on": WEB_ON, "key": KEY_ATTR, "url": URL_ATTR}.get(kind, curses.A_DIM)
                try:
                    scr.addnstr(0, x, txt, max(0, w - x - 1), a)
                except curses.error:
                    pass
                if code is not None:
                    st["hit"].append((0, x, x + len(txt) - 1, code))
                x += len(txt)
            for y, ln in enumerate(lines[st["top"]: st["top"] + body]):
                li = st["top"] + y
                y += tb
                inside = cur_span is not None and cur_span[0] <= li <= cur_span[1]
                head = inside and li == cur_span[0]
                try:
                    if inside:
                        scr.addstr(y, 0, ("✔ " if st["locked"] else "▶ ") if head else "  ", hi)
                    if head:
                        scr.addnstr(y, GUTTER, plain(ln).ljust(w - GUTTER - 1), w - GUTTER - 1, hi)
                        continue
                except curses.error:
                    pass
                x = GUTTER
                for txt, fg, bg, bold, dim in parse_ansi(ln):
                    try:
                        scr.addnstr(y, x, txt, max(0, w - x - 1), attr_of(fg, bg, bold, dim))
                    except curses.error:
                        pass
                    x += len(txt)
                    if x >= w - 1:
                        break
            # footer: mode bar, then the key helpers
            nxt = max(0, int(st["interval"] - (time.time() - last)))
            if st["locked"]:
                mode, mattr = f" SELECTED  {label()} ", SEL_ATTR
                info = "details shown · pick an action below"
            else:
                mode, mattr = " NAVIGATE ", NAV_ATTR
                info = "↑ ↓ move the highlight, ⏎ selects it"
            info = st["msg"] or f"{info}   · lines {st['top'] + 1}-{min(len(lines), st['top'] + body)}/{len(lines)} · next refresh {nxt}s"
            try:
                scr.addnstr(h - foot, 0, " " * (w - 1), w - 1, curses.A_REVERSE)
                scr.addnstr(h - foot, 0, mode, w - 1, mattr)
                scr.addnstr(h - foot, len(mode) + 1, info, max(0, w - len(mode) - 3), curses.A_REVERSE)
                for row, cx, (key, desc, code, mark) in placed:
                    y, x = h - foot + 2 + row, cx + 1
                    cap = f" {key} "
                    scr.addnstr(y, x, cap, max(0, w - x - 1), BACK_ATTR if mark == "back" else KEY_ATTR)
                    scr.addnstr(y, x + len(cap) + 2, desc, max(0, w - x - len(cap) - 3), curses.A_BOLD if mark else 0)
                    if code is not None:
                        st["hit"].append((y, x, x + len(cap) + 2 + len(desc), code))
            except curses.error:
                pass
            scr.refresh()

            k = pending if pending is not None else scr.getch()
            pending = None
            if k != -1:
                st["msg"] = ""
            if k not in (-1, ord("m")):
                st["more"] = False                               # the full key list closes after the next key (the key still acts)
            if k != 27 and k != -1:
                st["last_esc"] = None
            if k == 27:
                scr.timeout(40)                                  # Esc+'+' / Esc+'-' is how a terminal can send ⌘+ / ⌘- (see README)
                nk = scr.getch()
                scr.timeout(500)
                if nk in (ord("+"), ord("="), ord("-"), ord("_")):
                    level_key(chr(nk).replace("_", "-"))
                elif nk == -1:
                    act = esc_action(st["locked"], st["last_esc"], time.time())
                    if act == "quit":
                        return
                    if act == "back":
                        select(False)
                        st["msg"] = "back to the menu: ↑ ↓ move, ⏎ selects"
                    else:
                        st["last_esc"] = time.time()
                        st["msg"] = "press Esc again (or q) to quit"
            elif k == ord("q"):
                return
            elif k in (ord("b"), ord("B")) and st["locked"]:
                select(False)
                st["msg"] = "back to the menu: ↑ ↓ move, ⏎ selects"
            elif k == ord("m"):
                st["more"] = not st["more"]
            elif k in (ord("r"), ord("R")):
                redraw(refetch=True)
            elif k == ord("w"):
                web_start()
            elif k == ord("W"):
                if st["web"]:
                    web_stop()
                else:
                    st["msg"] = "the web server is not running (w starts it)"
            elif k == 12:                                        # Ctrl-L: repaint the whole screen
                scr.clearok(True)
            elif k in (curses.KEY_DOWN, 9, ord("n")):
                move(1, body)
            elif k in (curses.KEY_UP, curses.KEY_BTAB, ord("N")):
                move(-1, body)
            elif k == ord("j"):
                st["top"] += 1
            elif k == ord("k"):
                st["top"] -= 1
            elif k in (curses.KEY_NPAGE, curses.KEY_SF, ord(" ")):
                st["top"] += body - 2
            elif k in (curses.KEY_PPAGE, curses.KEY_SR):
                st["top"] -= body - 2
            elif k in (ord("g"), curses.KEY_HOME):
                st["top"] = 0
            elif k in (ord("G"), curses.KEY_END):
                st["top"] = len(lines)
            elif k in (ord("a"), ord("c"), ord("p"), ord("v"), ord("t")):
                toggle({ord("a"): "show_arc", ord("c"): "compact", ord("p"): "no_prompts", ord("v"): "verbose", ord("t"): "arc_prompt"}[k])
            elif k in (ord("+"), ord("="), ord("-"), ord("_")) or ord("1") <= k <= ord("5"):
                level_key(chr(k).replace("_", "-"))
            elif k in (ord("["), ord("]")):
                st["interval"] = step_interval(st["interval"], k == ord("]"))
            elif k in (10, 13, curses.KEY_ENTER, ord("y"), ord("Y")):
                i = idx()
                if i is None:
                    st["msg"] = "no chat to select"
                elif not st["locked"] and k in (10, 13, curses.KEY_ENTER):
                    select(True)
                    st["msg"] = "selected: ⏎ copies the resume command, b or Esc goes back to the menu"
                else:
                    st["msg"] = copy_resume(view["items"][i]["resume"], label())
            elif k in (ord("i"), ord("f")) and st["locked"] and idx() is not None:
                it = view["items"][idx()]
                st["msg"] = copy_text(it["sid"], "session id", label()) if k == ord("i") else copy_text(it["clean"], "fresh-chat command", label())
            elif k == curses.KEY_MOUSE:
                try:
                    _, mx, my, _, bstate = curses.getmouse()
                except curses.error:
                    continue
                if bstate & getattr(curses, "BUTTON4_PRESSED", 0):
                    st["top"] -= 3
                elif bstate & getattr(curses, "BUTTON5_PRESSED", 0):
                    st["top"] += 3
                elif tb <= my < body + tb:
                    i = item_at(spans, st["top"] + my - tb)
                    if i is not None:
                        again = st["locked"] and view["items"][i]["sid"] == st["cur"]
                        st["cur"] = view["items"][i]["sid"]
                        if again:
                            st["msg"] = copy_resume(view["items"][i]["resume"], label())
                        else:
                            select(True)
                            st["msg"] = "selected: click it again or ⏎ to copy the resume command"
                else:
                    pending = next((code for y, x0, x1, code in st["hit"] if y == my and x0 <= mx <= x1), None)
            elif k == curses.KEY_RESIZE:
                redraw()
            if time.time() - last >= st["interval"] or (st["hub"] and st["web"].running and st["hub"].take_refresh()):
                redraw(refetch=True)                             # timer, or a browser asked (its refresh button, archived on)

    stop = []
    try:
        curses.wrapper(lambda scr: run(scr, stop))
    finally:
        C.margin = 0
        for srv in stop:
            srv.stop("the TUI quit")
