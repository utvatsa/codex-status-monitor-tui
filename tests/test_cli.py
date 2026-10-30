import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest

import helpers
from cust_codex_status import cli


def run(*args, home=None):
    env = dict(os.environ, NO_COLOR="1")
    env.pop("CODEX_HOME", None)
    if home:
        env["HOME"] = home
        env["CODEX_HOME"] = os.path.join(home, ".codex")
    return subprocess.run([sys.executable, helpers.TOOL, *args], capture_output=True, text=True, env=env, timeout=60)


class ParseTests(unittest.TestCase):
    def test_defaults(self):
        a = cli.parse([])
        self.assertEqual((a.level, a.show_live, a.show_arc, a.compact, a.no_prompts), (75, True, False, False, True))

    def test_detailed_means_archived_and_subagents(self):
        a = cli.parse(["-D"])
        self.assertEqual((a.show_arc, a.verbose, a.show_live), (True, True, True))

    def test_archived_only_hides_live(self):
        a = cli.parse(["-A"])
        self.assertEqual((a.show_live, a.show_arc), (False, True))

    def test_explicit_flag_survives_a_low_level(self):
        a = cli.parse(["--level", "95", "--compact"])
        self.assertTrue(a.compact and a.show_arc)

    def test_removed_table_flag_is_rejected(self):
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            cli.parse(["--table"])


class EndToEndTests(unittest.TestCase):
    """Runs the real launcher against a fake HOME, so it never touches the real ~/.codex."""

    def test_version_and_help(self):
        self.assertRegex(run("--version").stdout, r"cust-codex-status \d+\.\d+\.\d+")
        h = run("--help").stdout
        for word in ("--level", "OK     nothing to do", "AMBER", "RED"):
            self.assertIn(word, h)

    def test_empty_home_renders_every_level(self):
        with tempfile.TemporaryDirectory() as d:
            for level in ("0", "50", "75", "100"):
                p = run("--level", level, home=d)
                self.assertEqual(p.returncode, 0, p.stderr)
                self.assertIn("CODEX ▸ status", p.stdout)

    def test_json_lists_archived_sessions_from_the_fake_home(self):
        with tempfile.TemporaryDirectory() as d:
            helpers.make_home(d, sessions=2)
            data = json.loads(run("--json", "-A", home=d).stdout)
        self.assertEqual(data["account"]["email"], "test@example.com")
        self.assertNotIn("SECRET", json.dumps(data))                                  # auth.json tokens never reach the output
        self.assertEqual(len(data["sessions"]), 2)
        for key in ("account", "usage", "sessions", "metrics"):
            self.assertIn(key, data)
        self.assertEqual(data["metrics"]["threads"], 0)                              # archived only: nothing live
        self.assertIsNone(data["metrics"]["cache_pct"])
        self.assertEqual(data["metrics"]["rate_limit"]["label"], "5-hour session")   # the fake rollouts carry 12% / 3% windows
        self.assertEqual(data["sessions"][0]["tokens"]["turns"], 2)

    def test_full_report_shows_health_for_archived_chat(self):
        with tempfile.TemporaryDirectory() as d:
            helpers.make_home(d, sessions=1)
            out = run("--level", "95", home=d).stdout
        self.assertIn("archived threads", out)
        self.assertIn("Chat number 0", out)
        self.assertIn("[OK]", out)

    def test_forcing_the_tui_without_a_terminal_is_an_error(self):
        p = run("-t")
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("needs a real terminal", p.stderr)

    def test_default_without_a_terminal_falls_back_to_the_static_report(self):
        p = run()                                   # pytest/subprocess has no tty: full-screen is the default but cannot start
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("CODEX ▸ status", p.stdout)

    def test_no_tui_flag_and_archived_prompt_flag(self):
        a = cli.parse(["--no-tui", "--no-arc-prompt"])
        self.assertTrue(a.no_tui and not a.arc_prompt and a.expand is None)
        self.assertTrue(cli.parse([]).arc_prompt)
        with tempfile.TemporaryDirectory() as d:
            helpers.make_home(d, sessions=1)
            self.assertIn("now ship it", run("--level", "95", "--no-tui", home=d).stdout)
            self.assertNotIn("now ship it", run("--level", "95", "--no-arc-prompt", home=d).stdout)


if __name__ == "__main__":
    unittest.main()
