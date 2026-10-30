"""Command-line entry point: flags, and the one-shot / watch / interactive modes."""
import argparse
import json
import os
import re
import sys
import time

from . import __version__, config, report
from .config import WEB_IDLE_SECS, WEB_PORT, set_web, web_enabled
from .util import C
from .views import DEFAULT_LEVEL, LEVEL_REPS, apply_level

EPILOG = """view levels (--level 0-100, default 75):
  0-19 minimal    one line per live chat + health counts
  20-44 compact   adds usage limits and attention warnings
  45-69 lean      one short card per chat
  70-89 standard  full cards (folder, ids, resume/clean commands, tips); no prompt lines
  90-100 full     adds first/latest prompts, subagents and the archived list
  Explicit flags (--compact, -D, -v, --no-prompts) add to the chosen level.

health badge (every chat, live and archived):
  OK     nothing to do
  AMBER  context >= 85%, waiting on approval, or idle > 1h holding memory (a CLI chat's own process)
  RED    context >= 95%

archived chats: capped at 20 rows. Raise it with -n 50 (any number), -n 0 for all; -d DAYS sets how far back
  to look (default 7). Live chats are never limited.

fields on a card:
  CONTEXT  last turn's input (cached included) vs the model's context window, as Codex reports it
  in/out   uncached input / output tokens (reasoning is part of out); cache-r = input served from the prompt cache
  resume   `cd <folder> && codex resume <id>`: continue the chat in the terminal (close it elsewhere first, or `codex fork <id>`)
  clean    a fresh chat in the same folder

full-screen view: on a terminal the tool opens the full-screen interactive view by default. Static output is used
  when piped (no terminal), with --no-tui, --json, -w, -i or --no-color. Keys are listed at the bottom of the screen.

web view (optional add-on, local only): the same report in a browser at http://127.0.0.1:8765 (or the next free port).
  --web on a terminal opens the TUI and the browser together; in the TUI `w` starts it (or opens the page again) and `W`
  stops it; the URL is on the top line. Without a terminal (or with --no-tui) --web serves the page on its own; --detach
  runs that in the background. The server reads nothing itself: it shows the data the TUI (or the --web loop) already
  read, and it stops after 60s with no browser open. Turn the add-on off or on with --set-web off|on.

examples:
  cust-codex-status                  full-screen view (static output when piped); --no-tui for a one-shot report
  cust-codex-status --no-tui         one-shot standard report of live chats
  cust-codex-status --level 40       less detail (0 = minimal); --level 95 = everything
  cust-codex-status -c               also show full account details
  cust-codex-status -D -n 50 -d 30   everything, up to 50 archived chats from the last 30 days
  cust-codex-status -A -n 0          every archived chat in the last 7 days
  cust-codex-status -p myproj -v     chats whose path contains "myproj", with the latest 3 subagents each
  cust-codex-status -w 5             live dashboard, refresh every 5s (Ctrl-C quits)
  cust-codex-status -i               report, then a prompt: [r] refresh, [1-5] or 0-100 to change the view, [q] quit
  cust-codex-status -t               force the full-screen view (errors without a terminal)
  cust-codex-status --web            full-screen view plus the same report in your browser
  cust-codex-status --web --detach   browser view only, in the background (stops 60s after the last tab closes)
  cust-codex-status --json | jq .    raw data for scripts"""


def build_parser():
    ap = argparse.ArgumentParser(
        prog="cust-codex-status", formatter_class=argparse.RawDescriptionHelpFormatter,
        description="Live diagnostic for OpenAI Codex: account, usage limits, and every chat/session\n"
                    "(terminal, desktop app, VS Code, JetBrains/ACP, exec) with model, tokens, context window and subagents.\n"
                    "Read-only, no API calls, uses no model tokens.",
        epilog=EPILOG)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("-a", "--active", action="store_true", help="live chats only (this is the default)")
    g.add_argument("-A", "--archived", action="store_true", help="archived/ended chats only, newest 20 (see -n, -d)")
    g.add_argument("-D", "--detailed", action="store_true", help="everything: live and archived chats, with subagents")
    ap.add_argument("--level", type=int, default=DEFAULT_LEVEL, metavar="0-100",
                    help="how much to show: 0 minimal .. 100 everything (default 75). 0-19 minimal, 20-44 compact, "
                         "45-69 lean cards, 70-89 standard, 90-100 full (+prompts, subagents, archived)")
    ap.add_argument("--compact", action="store_true", help="one line per live chat plus usage limits")
    ap.add_argument("--no-prompts", action="store_true", help="hide the first/latest prompt lines")
    ap.add_argument("-d", "--days", type=int, default=7, help="how far back archived chats go (default 7)")
    ap.add_argument("-n", type=int, default=None, metavar="N", help="max archived rows (default 20; a larger N is allowed; 0 = all)")
    ap.add_argument("-p", "--project", help="only chats whose project path contains this text")
    ap.add_argument("-c", "--account", action="store_true", help="show full account details (default: plan on the header only)")
    ap.add_argument("-s", "--subagents", action="store_true", help="list every subagent under each chat")
    ap.add_argument("-v", "--verbose", action="store_true", help="show the latest 3 subagents per chat")
    ap.add_argument("-w", "--watch", type=int, metavar="SECS", help="auto-refresh every SECS seconds (Ctrl-C to quit)")
    ap.add_argument("-i", "--interactive", action="store_true",
                    help="after the report, prompt: [r]efresh, [1-5] or 0-100 to change the view, [q]uit")
    ap.add_argument("-t", "--tui", action="store_true",
                    help="force the full-screen interactive view (it is already the default on a terminal; errors when there is none)")
    ap.add_argument("--no-tui", action="store_true", help="no full-screen view: print one static report and exit")
    ap.add_argument("--no-arc-prompt", action="store_true", help="hide the one-line prompt under each archived chat")
    ap.add_argument("--web", action="store_true",
                    help="also serve the report as a local web page and open it (with the TUI on a terminal, on its own otherwise)")
    ap.add_argument("--port", type=int, default=WEB_PORT, metavar="N", help=f"first port the web view tries (default {WEB_PORT}; 0 = any free port)")
    ap.add_argument("--no-open", action="store_true", help="with --web: print the URL, do not open a browser")
    ap.add_argument("--web-idle", type=int, default=WEB_IDLE_SECS, metavar="SECS",
                    help=f"the web server stops after SECS with no browser open (default {WEB_IDLE_SECS}; 0 = never)")
    ap.add_argument("--detach", action="store_true", help="with --web: serve in the background and return (for scripts and the skill)")
    ap.add_argument("--set-web", choices=["on", "off"], help="turn the optional web add-on on or off (saved in ~/.config/cust-codex-status)")
    ap.add_argument("--set-window", nargs=2, metavar=("TARGET", "SIZE"),
                    help="a context window: TARGET is a chat id (8+ characters: that chat only) or a model id (every chat on it); "
                         "SIZE: 200k, 1m or a token count, e.g. `--set-window 01a181c7 600k`")
    ap.add_argument("--levels", nargs=2, type=int, metavar=("AMBER", "RED"), help="with --set-window on a chat: its alert levels in %% of the window (default: suggested for the size)")
    ap.add_argument("--clear-window", metavar="TARGET", help="forget a window set with --set-window (back to automatic)")
    ap.add_argument("--set-context", nargs=3, metavar=("WINDOW", "AMBER", "RED"),
                    help="context alert levels in %% of the window, e.g. `--set-context 1m 60 90` (WINDOW: 200k or 1m)")
    ap.add_argument("--show-alerts", action="store_true", help="print the alert rules in effect (defaults plus your config) and the windows you set")
    ap.add_argument("--detached-child", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--json", action="store_true", help="raw JSON, no colours")
    ap.add_argument("--no-color", action="store_true")
    ap.add_argument("--version", action="version", version=f"cust-codex-status {__version__}")
    return ap


def parse(argv=None):
    """Parse flags into the options object the renderer and the TUI share."""
    args = build_parser().parse_args(argv)
    args.show_live = not args.archived
    args.show_arc = args.archived or args.detailed
    if args.detailed:
        args.verbose = True
    args.expand = None
    args.arc_prompt = not args.no_arc_prompt
    args.explicit = dict(compact=args.compact, no_prompts=args.no_prompts, show_arc=args.show_arc, verbose=args.verbose)
    apply_level(args)
    return args


def plain(line):
    return re.sub(r"\x1b\[[0-9;]*m", "", line)


WEB_OFF = "the web add-on is turned off: turn it on with `cust-codex-status --set-web on` (or ./install.sh --web)"


def alert_settings(args):
    """--set-window / --set-context / --show-alerts: the tool's own config only."""
    try:
        if args.set_window:
            target, size = args.set_window
            if config.is_chat_id(target):
                path = config.set_chat(target, size, *(args.levels or (None, None)))
                n = config.parse_size(size)
                lv = config.chat_levels(target) or config.suggest_levels(n)
                print(f"chat {target[:8]}: window {size}, amber {lv[0]}%, red {lv[1]}% (saved in {path})")
            else:
                path = config.set_window(target, size)
                print(f"every chat on {target}: window {size} (saved in {path})")
        if args.clear_window:
            path = config.clear_chat(args.clear_window) if config.is_chat_id(args.clear_window) else config.clear_window(args.clear_window)
            print(f"window for {args.clear_window} is automatic again (saved in {path})")
        if args.set_context:
            w, a, r = args.set_context
            path = config.set_context(w, int(a), int(r))
            print(f"context alerts for {w} windows: amber {a}%, red {r}% (saved in {path})")
    except ValueError as e:
        sys.exit(f"cust-codex-status: {e}")
    if args.show_alerts or not (args.set_window or args.set_context or args.clear_window):
        print(json.dumps(dict(alerts=config.alert_rules(), windows=config.window_overrides(), chat_levels=(config.user_config().get("chat_levels") or {}),
                              built_in_windows=config.DEFAULT_WINDOWS), indent=2))
    return 0


def main(argv=None):
    args = parse(argv)
    if args.set_web:
        path = set_web(args.set_web == "on")
        print(f"web add-on {args.set_web} (saved in {path})" + ("; try: cust-codex-status --web" if args.set_web == "on" else ""))
        return 0
    if args.set_window or args.clear_window or args.set_context or args.show_alerts:
        return alert_settings(args)
    C.on = sys.stdout.isatty() and not args.no_color and not args.json and "NO_COLOR" not in os.environ
    C.use_terminal()

    has_tty = sys.stdout.isatty() and sys.stdin.isatty()
    wants_tui = args.tui or not (args.no_tui or args.json or args.watch or args.interactive or args.no_color)
    if args.web:
        if not web_enabled():
            sys.exit(WEB_OFF)
        if args.detach:
            from .web import detach
            return detach(sys.argv[1:] if argv is None else list(argv))
        if not (wants_tui and has_tty) or args.json:
            from .web import serve
            return serve(args)
    if wants_tui and has_tty:
        args.tui = True
        from .tui import tui
        return tui(args)
    if args.tui:
        sys.exit("--tui needs a real terminal")

    def once(prev=None):
        """Print one report. In watch mode, lines that differ from the previous refresh get a coral bar."""
        if args.json:
            print(json.dumps(report.raw(args), indent=2, default=str))
            return ""
        text = report.text(args)
        if prev is None:
            print(text)
        else:
            print("\n".join(C.t("secondary", "▌", True) + ln[1:] if ln.startswith("  ") and plain(ln) not in prev else ln for ln in text.split("\n")))
        return text

    if args.watch:
        try:
            prev = None
            while True:
                print("\033[2J\033[H", end="")
                text = once(prev)
                prev = {plain(ln) for ln in text.split("\n")}
                print(C.t("dim", f"\nrefreshing every {args.watch}s, Ctrl-C to quit"), flush=True)
                time.sleep(args.watch)
        except KeyboardInterrupt:
            return
    once()
    if args.interactive and sys.stdin.isatty() and not args.json:
        while True:
            try:
                k = input(C.w("1", "\n[r] refresh   [1-5] view: 1 minimal 2 compact 3 lean 4 standard 5 full   [6-100] exact level   [q] quit > ")).strip().lower()
            except (EOFError, KeyboardInterrupt):
                return
            if k in ("q", "quit", "exit"):
                return
            if k.isdigit():
                args.level = LEVEL_REPS[int(k) - 1] if 1 <= int(k) <= 5 else int(k)
                apply_level(args)
            print("\033[2J\033[H", end="")
            once()
