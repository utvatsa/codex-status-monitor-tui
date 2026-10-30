import http.client
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

import helpers
from cust_codex_status import config, report, tui
from cust_codex_status.views import make_options
from cust_codex_status.web.bridge import Hub, snapshot
from cust_codex_status.web.server import FILES, WebServer, static_files


def data(rows=None):
    rows = rows if rows is not None else [helpers.row(), helpers.row(session_id="arc-1", active=False, state="ended", pid=None, ctx=190_000)]
    return rows, 0, dict(email="test@example.com", plan="pro", tier="t"), {}


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = mock.patch.object(config, "USER_CONFIG", os.path.join(self.tmp, "cfg", "config.json"))
        self.p.start()
        self.env = mock.patch.dict(os.environ)
        self.env.start()
        os.environ.pop("CUST_CODEX_STATUS_WEB", None)

    def tearDown(self):
        self.p.stop()
        self.env.stop()

    def test_on_by_default(self):
        self.assertTrue(config.web_enabled())

    def test_set_web_off_and_on(self):
        config.set_web(False)
        self.assertFalse(config.web_enabled())
        config.set_web(True)
        self.assertTrue(config.web_enabled())

    def test_env_overrides_the_file(self):
        config.set_web(False)
        os.environ["CUST_CODEX_STATUS_WEB"] = "1"
        self.assertTrue(config.web_enabled())
        os.environ["CUST_CODEX_STATUS_WEB"] = "off"
        self.assertFalse(config.web_enabled())

    def test_bad_file_means_default(self):
        os.makedirs(os.path.dirname(config.USER_CONFIG))
        with open(config.USER_CONFIG, "w") as f:
            f.write("[1, 2")
        self.assertTrue(config.web_enabled())


class SnapshotTests(unittest.TestCase):
    def test_json_ready_with_health_from_python(self):
        s = snapshot(data(), make_options(level=95))
        json.dumps(s)
        live, arc = s["sessions"]
        self.assertEqual((live["health"], arc["health"]), ("OK", "RED"))
        self.assertIn("context 95% full", arc["why"][0])
        self.assertTrue(live["resume"].endswith("codex resume " + live["sid"]))
        self.assertEqual(s["totals"]["live"], 1)
        self.assertEqual(s["totals"]["health"], {"OK": 1, "AMBER": 0, "RED": 0})

    def test_totals_carry_the_codex_metrics_behind_the_tiles(self):
        m = snapshot(data(), make_options(level=75))["totals"]["metrics"]
        json.dumps(m)
        for k in ("threads", "turns", "tokens", "cache_pct", "cached", "fresh_input", "reasoning_pct", "reasoning", "output",
                  "tokens_per_turn", "headroom_pct", "headroom_chat", "approval", "effort"):
            self.assertIn(k, m)
        self.assertEqual(m["threads"], 1)

    def test_subagents_carry_their_code(self):
        sub = dict(id="acd8d62eb3e440f19", type="Plan", desc="Review the spec", model="gpt-5.5", tokens=dict(input=10, output=2500, cache_read=0, cache_write=0, turns=7), ctx=5000,
                   mtime=time.time(), state="running")
        live = snapshot(data([helpers.row(subagents=[sub])]), make_options(level=75))["sessions"][0]
        self.assertEqual(live["subagents"][0]["code"], "acd8d62eb3e440f19")
        self.assertEqual((live["subagents"][0]["type"], live["subagents"][0]["running"]), ("Plan", True))
        self.assertEqual((live["subagents"][0]["turns"], live["subagents"][0]["out"]), (7, "2.5k"))               # brief stats for the agents list

    def test_has_arc_follows_the_fetch(self):
        self.assertFalse(snapshot(data(), make_options(level=75))["view"]["has_arc"])
        self.assertTrue(snapshot(data(), make_options(level=75), with_arc=True)["view"]["has_arc"])
        self.assertTrue(snapshot(data(), make_options(level=95))["view"]["has_arc"])

    def test_usage_limits_are_formatted(self):
        usage = dict(fetchedAtMs=int(time.time() * 1000), utilization=dict(limits=[
            dict(kind="session", percent=42, resets_at="2999-01-01T00:00:00+00:00", is_active=True)]))
        u = snapshot((data()[0], 0, {}, usage), make_options())["usage"]
        self.assertEqual((u["limits"][0]["label"], u["limits"][0]["pct"], u["limits"][0]["binding"], u["stale"]), ("5-hour session", 42, True, False))


class HubTests(unittest.TestCase):
    def test_publish_wakes_a_waiter(self):
        hub, got = Hub(), []
        t = threading.Thread(target=lambda: got.append(hub.wait(0, 5)))
        t.start()
        hub.publish(data(), make_options())
        t.join(5)
        self.assertEqual(got[0][0], 1)
        self.assertIn(b'"sessions"', got[0][1])

    def test_wait_times_out_without_news(self):
        hub = Hub()
        hub.publish(data(), make_options())
        self.assertEqual(hub.wait(1, 0.05), (1, None))

    def test_refresh_request_is_taken_once_and_archived_sticks(self):
        hub = Hub()
        self.assertFalse(hub.take_refresh())
        hub.request_refresh(archived=True)
        self.assertTrue(hub.take_refresh())
        self.assertFalse(hub.take_refresh())
        hub.request_refresh(archived=False)
        self.assertTrue(hub.want_arc)

    def test_idle_clock(self):
        hub = Hub()
        hub.last_seen -= 100
        self.assertGreater(hub.idle_for(), 99)
        hub.touch(+1)
        self.assertEqual(hub.idle_for(), 0.0)


class CompareStripTests(unittest.TestCase):
    """The strip is pinned and publishes its height; every page's own sticky or fixed parts must sit below it (a bug once let Aurora's floating
    header run over the strip)."""
    def read(self, *p):
        with open(os.path.join(helpers.ROOT, *p)) as f:
            return f.read()

    def test_strip_is_pinned_and_publishes_its_height(self):
        self.assertIn("position: sticky", self.read("web-ui", "public", "compare.css"))
        self.assertIn("--cmp-h", self.read("web-ui", "public", "compare.js"))

    def test_pages_place_fixed_and_sticky_parts_below_it(self):
        for p in (("web-ui", "src", "v2", "app.css"), ("web-ui", "src", "components", "TopBar.module.css"), ("web-ui", "src", "App.module.css"),
                  ("web-ui", "public", "plain", "app.css")):
            self.assertIn("--cmp-h", self.read(*p), p)


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.hub = Hub("tui")
        self.srv = WebServer(self.hub, port=0, idle=0).start()
        self.port = self.srv.httpd.server_address[1]

    def tearDown(self):
        self.srv.stop()

    def req(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.request(method, path, body=body, headers=headers or {})
        r = c.getresponse()
        out = (r.status, dict(r.getheaders()), r.read())
        c.close()
        return out

    def test_binds_localhost_only(self):
        self.assertEqual(self.srv.httpd.server_address[0], "127.0.0.1")
        self.assertTrue(self.srv.url.startswith("http://127.0.0.1:"))

    def test_page_and_static_files(self):
        code, h, body = self.req("GET", "/")
        self.assertEqual(code, 200)
        self.assertIn(b'<div id="root">', body)
        self.assertIn("default-src 'self'", h["Content-Security-Policy"])
        self.assertTrue(any(f.startswith("assets/") and f.endswith(".js") for f in FILES), "run `npm run build` in web-ui/")
        for f in FILES:
            code, h, _ = self.req("GET", "/static/" + f)
            self.assertEqual(code, 200, f)
            self.assertEqual(h["Cache-Control"], "public, max-age=31536000, immutable" if f.startswith("assets/") else "no-store")

    def test_bundles_carry_the_orchid_terminal_themes(self):
        css = b"".join(self.req("GET", "/static/" + f)[2] for f in FILES if f.startswith("assets/") and f.endswith(".css"))
        for theme in (b'data-theme=sunset', b'data-theme=phosphor', b'data-theme=ink'):
            self.assertIn(theme, css.replace(b'"', b""))
        for retired in (b"dracula", b"nord", b"#0891b2"):          # the old navy / cyan look is gone
            self.assertNotIn(retired, css)

    def test_page_references_only_built_files(self):
        for path in ("/", "/plain", "/react2"):
            code, _, body = self.req("GET", path)
            self.assertEqual(code, 200, path)
            refs = re.findall(rb'(?:src|href)="/static/([^"]+)"', body)
            self.assertTrue(refs, path)
            for ref in refs:
                self.assertIn(ref.decode(), FILES)

    def test_three_versions_are_three_different_pages(self):
        bodies = {p: self.req("GET", p)[2] for p in ("/", "/plain", "/react2")}
        self.assertEqual(len(set(bodies.values())), 3)
        self.assertIn(b"assets/v2-", bodies["/react2"])      # Aurora's own bundle
        self.assertEqual(self.req("GET", "/react2/")[0], 200)
        for path in ("/react2/x", "/classic"):
            self.assertEqual(self.req("GET", path)[0], 404, path)

    def test_plain_version_is_served_next_to_the_react_one(self):
        for path in ("/plain", "/plain/"):
            code, h, body = self.req("GET", path)
            self.assertEqual(code, 200, path)
            self.assertIn("text/html", h["Content-Type"])
            self.assertIn(b"/static/plain/app.js", body)
            for ref in re.findall(rb'(?:src|href)="/static/([^"]+)"', body):
                self.assertIn(ref.decode(), FILES)
        self.assertEqual(self.req("GET", "/plain/x")[0], 404)

    def test_every_version_loads_the_compare_strip(self):
        for path in ("/", "/plain", "/react2"):
            self.assertIn(b"/static/compare.js", self.req("GET", path)[2], path)

    def test_allow_list_skips_unknown_types(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "assets"))
            for nm in ("index.html", "assets/a.js", "notes.txt", "assets/x.py"):
                open(os.path.join(tmp, nm), "w").close()
            self.assertEqual(sorted(static_files(tmp)), ["assets/a.js", "index.html"])

    def test_nothing_else_on_disk_is_served(self):
        for p in ("/static/../server.py", "/static/%2e%2e/server.py", "/static/bridge.py", "/etc/passwd"):
            self.assertEqual(self.req("GET", p)[0], 404, p)

    def test_foreign_host_is_refused(self):
        self.assertEqual(self.req("GET", "/api/state", headers={"Host": "evil.example:80"})[0], 403)

    def test_cross_origin_post_is_refused(self):
        self.assertEqual(self.req("POST", "/api/refresh", b"{}", {"Origin": "http://evil.example"})[0], 403)
        self.assertFalse(self.hub.take_refresh())

    def test_no_cors_header(self):
        _, h, _ = self.req("GET", "/api/state", headers={"Origin": "http://evil.example"})
        self.assertNotIn("Access-Control-Allow-Origin", h)

    def test_state_before_and_after_publish(self):
        self.assertEqual(self.req("GET", "/api/state")[0], 503)
        self.hub.publish(data(), make_options())
        code, _, body = self.req("GET", "/api/state")
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body)["source"], "tui")

    def test_refresh_reaches_the_owner(self):
        code, _, _ = self.req("POST", "/api/refresh", json.dumps({"archived": True}).encode(),
                              {"Content-Type": "application/json", "Origin": f"http://127.0.0.1:{self.port}"})
        self.assertEqual(code, 202)
        self.assertTrue(self.hub.take_refresh())
        self.assertTrue(self.hub.want_arc)

    def test_event_stream_sends_the_snapshot_and_counts_the_client(self):
        self.hub.publish(data(), make_options())
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.request("GET", "/api/events")
        r = c.getresponse()
        self.assertEqual(r.getheader("Content-Type"), "text/event-stream")
        self.assertEqual(r.fp.readline(), b"event: snapshot\n")
        self.assertTrue(r.fp.readline().startswith(b"data: {"))
        self.assertEqual(self.hub.clients, 1)
        self.hub.publish(data([]), make_options())
        r.fp.readline()
        self.assertEqual(r.fp.readline(), b"event: snapshot\n")
        c.close()


class IdleStopTests(unittest.TestCase):
    def test_stops_itself_with_no_browser(self):
        why = []
        srv = WebServer(Hub(), port=0, idle=0.3, on_stop=why.append).start()
        self.assertTrue(srv.stopped.wait(5))
        self.assertFalse(srv.running)
        self.assertIn("no browser connected", why[0])

    def test_port_in_use_moves_on(self):
        a = WebServer(Hub(), port=0, idle=0).start()
        b = WebServer(Hub(), port=a.httpd.server_address[1], idle=0).start()
        try:
            self.assertNotEqual(a.httpd.server_address[1], b.httpd.server_address[1])
        finally:
            a.stop()
            b.stop()


class FetchTests(unittest.TestCase):
    def test_with_arc_reads_archived_without_changing_the_view(self):
        with tempfile.TemporaryDirectory() as tmp:
            helpers.make_home(tmp, sessions=2)
            with mock.patch("cust_codex_status.data.CODEX", os.path.join(tmp, ".codex")), \
                 mock.patch("cust_codex_status.data.HOME", tmp), mock.patch("cust_codex_status.data._cli_version", return_value=None):
                o = make_options(level=75)
                self.assertEqual(len(report.fetch(o)[0]), 0)
                self.assertEqual(len(report.fetch(o, with_arc=True)[0]), 2)
                self.assertFalse(o.show_arc)


class WebBarTests(unittest.TestCase):
    def test_hidden_when_the_add_on_is_off(self):
        self.assertEqual(tui.web_bar(False), [])

    def test_off_offers_w(self):
        bar = tui.web_bar(True)
        self.assertIn(ord("w"), [c for _, c, _ in bar])
        self.assertNotIn(ord("W"), [c for _, c, _ in bar])

    def test_on_shows_url_and_stop(self):
        bar = tui.web_bar(True, "http://127.0.0.1:8765/", clients=2)
        text = "".join(t for t, _, _ in bar)
        self.assertIn("http://127.0.0.1:8765/", text)
        self.assertIn("2 browsers open", text)
        self.assertIn(ord("W"), [c for _, c, _ in bar])
        self.assertIn("stops after 60s", "".join(t for t, _, _ in tui.web_bar(True, "http://x/", 0)))


class CliTests(unittest.TestCase):
    def run_tool(self, home, *args, timeout=30):
        env = dict(os.environ, NO_COLOR="1", HOME=home)
        env.pop("CUST_CODEX_STATUS_WEB", None)
        return subprocess.run([sys.executable, helpers.TOOL, *args], capture_output=True, text=True, env=env, timeout=timeout)

    def test_set_web_off_blocks_web(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = self.run_tool(tmp, "--set-web", "off")
            self.assertEqual(r.returncode, 0)
            self.assertTrue(os.path.exists(os.path.join(tmp, ".config", "cust-codex-status", "config.json")))
            r = self.run_tool(tmp, "--web", "--no-tui")
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("--set-web on", r.stderr)

    def test_headless_web_serves_then_stops_when_idle(self):
        with tempfile.TemporaryDirectory() as tmp:
            helpers.make_home(tmp)
            r = self.run_tool(tmp, "--web", "--no-tui", "--no-open", "--port", "0", "--web-idle", "1", timeout=30)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("web view: http://127.0.0.1:", r.stdout)
            self.assertIn("no browser connected for 1s", r.stdout)


class OpenUrlTests(unittest.TestCase):
    def test_macos_uses_the_open_command(self):
        from unittest import mock
        from cust_codex_status import web
        with mock.patch.object(web.sys, "platform", "darwin"), \
                mock.patch.object(web.subprocess, "run", return_value=mock.Mock(returncode=0)) as run, \
                mock.patch.object(web.webbrowser, "open") as wb:
            self.assertTrue(web.open_url("http://127.0.0.1:8765/"))
        self.assertEqual(run.call_args[0][0], ["/usr/bin/open", "http://127.0.0.1:8765/"])
        wb.assert_not_called()

    def test_falls_back_to_webbrowser_then_reports_failure(self):
        from unittest import mock
        from cust_codex_status import web
        with mock.patch.object(web.sys, "platform", "darwin"), \
                mock.patch.object(web.subprocess, "run", return_value=mock.Mock(returncode=1)), \
                mock.patch.object(web.webbrowser, "open", return_value=True):
            self.assertTrue(web.open_url("http://x/"))
        with mock.patch.object(web.sys, "platform", "linux"), \
                mock.patch.object(web.webbrowser, "open", return_value=False):
            self.assertFalse(web.open_url("http://x/"))
        with mock.patch.object(web.sys, "platform", "linux"), \
                mock.patch.object(web.webbrowser, "open", side_effect=RuntimeError):
            self.assertFalse(web.open_url("http://x/"))


if __name__ == "__main__":
    unittest.main()
