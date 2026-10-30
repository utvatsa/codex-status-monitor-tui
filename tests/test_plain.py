import json
import os
import shutil
import subprocess
import tempfile
import unittest

import helpers
from cust_codex_status.web.server import FILES

PLAIN = os.path.join(helpers.ROOT, "web-ui", "public", "plain")
NODE = shutil.which("node") or ("/opt/homebrew/bin/node" if os.path.exists("/opt/homebrew/bin/node") else None)


def read(name):
    with open(os.path.join(PLAIN, name), encoding="utf-8") as f:
        return f.read()


class PlainFilesTests(unittest.TestCase):
    """Cheap static guards for the plain-JS page (it has no build step and no JS test runner)."""

    def test_files_exist_and_are_served(self):
        for name in ("app.js", "app.css", "index.html", "alerts.mjs"):
            self.assertTrue(os.path.exists(os.path.join(PLAIN, name)), name)
        self.assertIn("plain/alerts.mjs", FILES)          # the packaged copy (npm run build) must be served too
        self.assertIn("plain/app.js", FILES)

    def test_app_uses_the_single_chat_setting_and_snooze_key(self):
        js, mod = read("app.js"), read("alerts.mjs")
        self.assertIn('"/api/config"', js)
        self.assertIn('from "./alerts.mjs"', js)
        self.assertIn("suggestLevels", js)
        self.assertIn("function suggestLevels", mod)
        self.assertIn('"cust-codex-status.snoozed"', mod)

    def test_read_only_wording(self):
        js = read("app.js")
        self.assertIn("read-only data", js)
        self.assertIn("The one thing it can change is the context window and alert levels of a single chat", js)

    def test_sticky_bar_keeps_its_compare_offset(self):
        self.assertIn("top: var(--cmp-h, 0px)", read("app.css"))


NODE_SCRIPT = r"""
import * as a from URL;
const eq = (x, y, m) => { if (JSON.stringify(x) !== JSON.stringify(y)) throw new Error(`${m}: ${JSON.stringify(x)} != ${JSON.stringify(y)}`); };
eq(a.suggestLevels(200000), [85, 95], "200k");
eq(a.suggestLevels(600000), [68, 92], "600k");
eq(a.suggestLevels(800000), [63, 91], "800k");
eq(a.suggestLevels(1000000), [60, 90], "1m");
eq(a.suggestLevels(2000000), [49, 88], "2m");
eq(a.parseSize("600k"), 600000, "600k"); eq(a.parseSize("1m"), 1000000, "1m"); eq(a.parseSize("1.5M"), 1500000, "1.5m");
eq(a.parseSize("500000"), 500000, "plain"); eq(a.parseSize("9k"), null, "too small"); eq(a.parseSize("11m"), null, "too big");
eq(a.parseSize("abc"), null, "junk"); eq(a.parseSize("10k"), 10000, "floor"); eq(a.parseSize("10m"), 10000000, "ceiling");
eq(a.tokOf(600000, "68"), "408k", "tokens from percent");
eq(a.pctOf(600000, "408k"), "68", "percent from tokens"); eq(a.pctOf(600000, "9m"), "100", "clamped high"); eq(a.pctOf(600000, "1"), "1", "clamped low");
eq(a.pctOf(600000, "x"), "", "junk tokens");
eq(a.problemOf(600000, a.rowFor(600000, 68), a.rowFor(600000, 92)), null, "valid");
eq(typeof a.problemOf(600000, a.rowFor(600000, 92), a.rowFor(600000, 68)), "string", "amber >= red");
eq(typeof a.problemOf(null, a.rowFor(600000, 68), a.rowFor(600000, 92)), "string", "no maximum");
eq(typeof a.problemOf(600000, { pct: "68", tok: "700k" }, a.rowFor(600000, 92)), "string", "tokens over maximum");
eq(a.chatCommand("abcdef123456", "600k", 68, 92), "cust-codex-status --set-window abcdef12 600k --levels 68 92", "command");

const A = { key: "mem", level: "AMBER" }, R = { key: "mem", level: "RED" };
let s = a.snooze({}, A);
eq(a.isMinimised(s, A), true, "snoozed amber stays a chip");
eq(a.isMinimised(s, R), false, "escalation opens it");
eq(a.isMinimised(a.snooze({}, R), A), true, "red snooze, eased to amber, is still a chip");
eq(a.prune(s, [R]), {}, "escalated alert is forgotten, so it stays open");
eq(a.isMinimised(a.prune(s, [R]), A), false, "... even if it later eases back");
eq(a.prune(s, []), {}, "cleared alert is forgotten");
eq(a.prune(s, [A]) === s, true, "nothing to forget: same object");
eq(a.unsnooze(s, "mem"), {}, "unsnooze");

const mem = (v) => ({ getItem: () => v, setItem(k, x) { this.saved = [k, x]; } });
eq(a.loadSnoozed(mem('{"mem":"RED"}')), { mem: "RED" }, "load");
eq(a.loadSnoozed(mem("not json")), {}, "bad json");
eq(a.loadSnoozed({ getItem() { throw new Error("blocked"); } }), {}, "storage throws");
const st = mem(null); a.saveSnoozed(st, { mem: "RED" }); eq(st.saved, ["cust-codex-status.snoozed", '{"mem":"RED"}'], "save");
a.saveSnoozed({ setItem() { throw new Error("blocked"); } }, {});

const sess = (o) => ({ sid: "s", active: true, why: [], waiting: null, health: "AMBER", window: "200.0k", window_source: "guess", ctx_pct: 90, ctx_amber: "170.0k",
  label: "chat", running_in: "VS Code", folder: "~/p", model: "m", tips: [], resume: "r", window_offer: null, ...o });
const snap = { sessions: [sess({ sid: "a", why: ["idle > 1h"] }), sess({ sid: "b", health: "RED", why: ["context 96%"] }), sess({ sid: "c", waiting: "Bash", waiting_for: "14m", why: ["waiting"] }),
  sess({ sid: "d", active: false, why: ["x"] })], usage: { limits: [{ label: "5-hour", pct: 90, resets: "1h" }, { label: "weekly", pct: 10, resets: "1d" }] } };
const items = a.attentionItems(snap);
eq(items.map((i) => i.key), ["b", "limit:5-hour", "c", "a"], "order");
eq(items[0].headline, "Context 90% of 200.0k (alerts from 170.0k)", "context headline");
eq(items[2].headline, "Waiting for your approval: Bash · for 14m", "waiting headline");
eq(items[0].link.href, "vscode://", "app link");
"""


@unittest.skipUnless(NODE, "node is not installed")
class PlainLogicTests(unittest.TestCase):
    def test_pure_functions_in_node(self):
        with tempfile.TemporaryDirectory() as tmp:
            script = os.path.join(tmp, "check.mjs")
            with open(script, "w", encoding="utf-8") as f:
                f.write(NODE_SCRIPT.replace("URL", json.dumps("file://" + os.path.join(PLAIN, "alerts.mjs")), 1))
            r = subprocess.run([NODE, script], capture_output=True, text=True, timeout=30)
            self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == "__main__":
    unittest.main()
