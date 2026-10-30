"""Optional web view: the same report in a browser, served locally while the TUI (or `--web` on its own) runs.
The page is a React app whose source is in web-ui/ (see web-ui/TUTORIAL.md); its build is committed under static/.

Imported only when used (`--web`, or `w` in the TUI), so it costs nothing otherwise. Turn the add-on off or on with
`cust-codex-status --set-web off|on` (or `./install.sh --no-web` / `--web`). See bridge.py for how data reaches the page."""
import os
import subprocess
import sys
import time
import webbrowser

from .. import report
from ..config import WEB_IDLE_SECS, WEB_PORT
from .bridge import Hub
from .server import WebServer


def start(source="tui", port=WEB_PORT, idle=WEB_IDLE_SECS, open_browser=True, on_stop=None):
    """Start a server with a fresh Hub: (server, hub). The caller publishes snapshots to the hub."""
    hub = Hub(source)
    srv = WebServer(hub, port=port, idle=idle, on_stop=on_stop).start()
    srv.opened = open_url(srv.url) if open_browser else None
    return srv, hub


def open_url(url):
    """Open the page in the default browser; True if something was launched.
    macOS: the system `open` command. Python's default there goes through AppleScript, which can fail silently
    (automation permission) when started from a terminal UI. Elsewhere, or if `open` fails, fall back to webbrowser."""
    if sys.platform == "darwin":
        try:
            if subprocess.run(["/usr/bin/open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10).returncode == 0:
                return True
        except (OSError, subprocess.SubprocessError):
            pass
    try:
        return bool(webbrowser.open(url, new=2))
    except Exception:
        return False


def serve(args):
    """`--web` without the TUI: fetch on the refresh timer (only while a page is open) or when a page asks, until idle or Ctrl-C."""
    interval = args.watch or 5
    idle = getattr(args, "web_idle", WEB_IDLE_SECS)
    srv, hub = start("headless", port=args.port, idle=idle, open_browser=not args.no_open)
    print(f"cust-codex-status web view: {srv.url}", flush=True)
    if getattr(args, "detached_child", False):
        null = os.open(os.devnull, os.O_RDWR)                 # the parent has read the URL and gone; nothing else to say
        os.dup2(null, 1)
        os.dup2(null, 2)
    else:
        print("read-only · " + (f"stops after {idle}s with no browser open" if idle else "runs until stopped") + " · Ctrl-C to stop now", flush=True)
    last = 0.0
    try:
        while not srv.stopped.is_set():
            due = hub.version == 0 or (hub.clients > 0 and time.time() - last >= interval)
            if hub.take_refresh() or due:
                hub.publish(report.fetch(args, with_arc=hub.want_arc), args, with_arc=hub.want_arc)
                last = time.time()
            srv.stopped.wait(0.25)
    except KeyboardInterrupt:
        pass
    finally:
        srv.stop("stopped")
    if not getattr(args, "detached_child", False):
        print(f"web view stopped: {srv.reason}")
    return 0


def detach(argv):
    """Run `--web` in the background (for the Codex skill, which has no terminal): start a child, print its URL, return.
    The child stops by itself once no browser has been connected for a minute."""
    src = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    env = dict(os.environ, PYTHONPATH=src + (os.pathsep + os.environ["PYTHONPATH"] if os.environ.get("PYTHONPATH") else ""))
    rest = [a for a in argv if a not in ("--detach", "--web", "--no-tui", "-t", "--tui")]
    child = subprocess.Popen([sys.executable, "-m", "cust_codex_status", "--web", "--no-tui", "--detached-child", *rest],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=env,
                             start_new_session=True, text=True)
    line = child.stdout.readline().strip()
    child.stdout.close()
    if not line.startswith("cust-codex-status web view:"):
        print(line or "the web server did not start", file=sys.stderr)
        return 1
    print(line)
    idle = next((int(rest[i + 1]) for i, a in enumerate(rest[:-1]) if a == "--web-idle" and rest[i + 1].isdigit()), WEB_IDLE_SECS)
    print(f"running in the background (pid {child.pid}); " + (f"it stops after {idle}s with no browser open" if idle else f"stop it with: kill {child.pid}"))
    return 0
