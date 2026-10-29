"""A small local web server (stdlib `http.server`): one page, its static files, the latest snapshot and a live stream.

Routes
  GET  /                 the React page, first design (static/index.html)
  GET  /plain            the plain-JS page (static/plain/index.html)
  GET  /react2           the React page, second design "Aurora" (static/v2.html)
  GET  /static/<file>    the built React page's files (a fixed allow-list made at start-up, nothing else on disk is served)
  GET  /api/state        the latest snapshot as JSON
  GET  /api/events       Server-Sent Events: the snapshot now, then again each time the owner publishes a new one
  POST /api/refresh      ask the owner to re-read the disk ({"archived": true} also asks for archived chats)
  POST /api/config       change the tool's own settings: {"window": {"model", "size"}} or {"context": {"window", "amber", "red"}}

Safety: binds 127.0.0.1 only; requests whose Host is not 127.0.0.1/localhost on our port are refused (DNS rebinding), a POST
from another origin is refused, no CORS headers are sent (other sites cannot read the data), and a strict CSP is set.
The server stops itself after `idle` seconds with no page connected."""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .. import config
from ..config import WEB_IDLE_SECS, WEB_PORT

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".mjs": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json"}


def static_files(root=STATIC):
    """{relative path: content type} of every servable file under static/ (the Vite build in web-ui/ writes it).
    Built once at import: requests are matched against these keys, never joined onto the disk path."""
    out = {}
    for d, _, names in os.walk(root):
        for nm in names:
            ext = os.path.splitext(nm)[1]
            if ext in TYPES:
                out[os.path.relpath(os.path.join(d, nm), root).replace(os.sep, "/")] = TYPES[ext]
    return out


FILES = static_files()
# Which built page each address serves (the files are in static/, built from web-ui/ by Vite): three versions of the same page.
PAGES = {"/": "index.html",                  # React (the first design)
         "/plain": "plain/index.html",       # plain JS: Preact + htm, no build step
         "/react2": "v2.html"}               # React, second design ("Aurora")
CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
PING_SECS = 15          # keep-alive comment on the event stream, so a closed tab is noticed


class Handler(BaseHTTPRequestHandler):
    server_version = "cust-codex-status"
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):             # quiet: the TUI owns the terminal
        pass

    def _host_ok(self):
        port = self.server.server_address[1]
        return (self.headers.get("Host") or "") in (f"127.0.0.1:{port}", f"localhost:{port}")

    def _origin_ok(self):
        o = self.headers.get("Origin")
        port = self.server.server_address[1]
        return o is None or o in (f"http://127.0.0.1:{port}", f"http://localhost:{port}")

    def _send(self, code, body=b"", ctype="text/plain; charset=utf-8", cache="no-store"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", CSP)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        hub = self.server.hub
        if not self._host_ok():
            return self._send(403, b"forbidden host")
        hub.touch()                                              # any page activity resets the idle clock
        path = self.path.split("?", 1)[0]
        if path.rstrip("/") in PAGES or path == "/":
            path = "/static/" + PAGES[path.rstrip("/") or "/"]
        if path.startswith("/static/") and path[8:] in FILES:
            with open(os.path.join(STATIC, path[8:]), "rb") as f:
                body = f.read()
            if path.startswith("/static/assets/"):           # content-hashed names: safe to cache for good
                return self._send(200, body, FILES[path[8:]], cache="public, max-age=31536000, immutable")
            return self._send(200, body, FILES[path[8:]])
        if path == "/favicon.ico":
            with open(os.path.join(STATIC, "favicon.svg"), "rb") as f:
                return self._send(200, f.read(), FILES["favicon.svg"])
        if path == "/api/state":
            _, body = hub.latest()
            return self._send(200, body, "application/json") if body else self._send(503, b'{"error":"no data yet"}', "application/json")
        if path == "/api/events":
            return self._events(hub)
        self._send(404, b"not found")

    def do_POST(self):
        if not self._host_ok() or not self._origin_ok():
            return self._send(403, b"forbidden")
        route = self.path.split("?", 1)[0]
        if route not in ("/api/refresh", "/api/config"):
            return self._send(404, b"not found")
        n = min(int(self.headers.get("Content-Length") or 0), 4096)
        try:
            ask = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            ask = {}
        if not isinstance(ask, dict):
            ask = {}
        if route == "/api/config":
            return self._config(ask)
        self.server.hub.request_refresh(archived=bool(ask.get("archived")))
        self.server.hub.touch()
        self._send(202, b'{"ok":true}', "application/json")

    def _config(self, ask):
        """The one write the page may ask for, and only for ONE chat: its context window and alert levels ({"chat": {"sid", "window",
        "amber"?, "red"?}}, or {"chat": {"sid", "clear": true}}). Model-wide and tool-wide settings are never changed from the page, and
        nothing of Codex's data is written."""
        c = ask.get("chat")
        try:
            if not isinstance(c, dict) or not isinstance(c.get("sid"), str):
                return self._send(400, b'{"ok":false,"error":"unknown setting"}', "application/json")
            if c.get("clear") is True:
                config.clear_chat(c["sid"])
            else:
                amber, red = c.get("amber"), c.get("red")
                config.set_chat(c["sid"], c.get("window"), None if amber is None else int(amber), None if red is None else int(red))
        except (ValueError, TypeError) as e:
            return self._send(400, json.dumps(dict(ok=False, error=str(e))).encode(), "application/json")
        self.server.hub.request_refresh()
        self.server.hub.touch()
        self._send(200, b'{"ok":true}', "application/json")

    def _events(self, hub):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        self.close_connection = True
        hub.touch(+1)
        try:
            seen, body = hub.latest()
            if body:
                self._event(body)
            while not hub.closed:
                seen, body = hub.wait(seen, PING_SECS)
                if hub.closed:
                    break
                if body:
                    self._event(body)
                else:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            hub.touch(-1)

    def _event(self, body):
        self.wfile.write(b"event: snapshot\ndata: " + body + b"\n\n")
        self.wfile.flush()


class WebServer:
    """Owns the listening socket, the serving thread and the idle watchdog. `start()` returns self; `url` says where."""

    def __init__(self, hub, port=WEB_PORT, idle=WEB_IDLE_SECS, on_stop=None):
        self.hub, self.port, self.idle, self.on_stop = hub, port, idle, on_stop
        self.httpd = None
        self.stopped = threading.Event()
        self._stopping = threading.Lock()
        self.reason = None
        self.started = None
        self.opened = None             # set by web.start(): True / False if a browser was asked to open, None if not asked

    @property
    def url(self):
        return f"http://127.0.0.1:{self.httpd.server_address[1]}/" if self.httpd else None

    @property
    def running(self):
        return self.httpd is not None and not self.stopped.is_set()

    def _bind(self):
        tries = [self.port + i for i in range(21)] + [0] if self.port else [0]
        last = None
        for p in tries:
            try:
                httpd = ThreadingHTTPServer(("127.0.0.1", p), Handler)
                httpd.daemon_threads = True
                return httpd
            except OSError as e:
                last = e
        raise last

    def start(self):
        self.httpd = self._bind()
        self.httpd.hub = self.hub
        self.started = time.time()
        self.hub.touch()                                         # the idle clock starts now
        threading.Thread(target=self.httpd.serve_forever, kwargs=dict(poll_interval=0.25), daemon=True, name="web-serve").start()
        threading.Thread(target=self._watch, daemon=True, name="web-idle").start()
        return self

    def _watch(self):
        while not self.stopped.wait(0.25) and not self._stopping.locked():
            if self.idle and self.hub.idle_for() > self.idle:
                self.stop(f"no browser connected for {self.idle}s")

    def stop(self, reason="stopped"):
        """Idempotent. `stopped` is set last, so whoever waits on it sees the reason and a closed socket."""
        if not self._stopping.acquire(blocking=False):
            return
        self.reason = reason
        self.hub.close()
        if self.httpd:
            if threading.current_thread().name != "web-serve":
                self.httpd.shutdown()
            self.httpd.server_close()
        if self.on_stop:
            self.on_stop(reason)
        self.stopped.set()
