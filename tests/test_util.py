import unittest

import helpers
from cust_codex_status import util


class UtilTests(unittest.TestCase):
    def test_fmt(self):
        self.assertEqual([util.fmt(n) for n in (0, None, 999, 1500, 2_500_000)], ["0", "0", "999", "1.5k", "2.5M"])

    def test_clip_collapses_whitespace_and_truncates(self):
        self.assertEqual(util.clip("a   b\n c", 20), "a b c")
        self.assertEqual(util.clip("x" * 30, 10), "x" * 9 + "…")
        self.assertEqual(util.clip(None, 5), "-")

    def test_colour_off_returns_plain_text(self):
        util.C.on = False
        self.assertEqual(util.C.w("31", "hi"), "hi")
        util.C.on = True
        try:
            self.assertEqual(util.vlen(util.C.w("31", "hi")), 2)
        finally:
            util.C.on = False

    def test_bar_width_and_colour_free_length(self):
        util.C.on = False
        self.assertEqual(util.vlen(util.bar(50, 10)), 10)
        self.assertEqual(util.bar(0, 4), "░░░░")
        self.assertEqual(util.bar(100, 4), "████")

    def test_pad_alignment(self):
        self.assertEqual(util.pad("ab", 4), "ab  ")
        self.assertEqual(util.pad("ab", 4, "r"), "  ab")

    def test_until_handles_past_and_garbage(self):
        self.assertEqual(util.until("2000-01-01T00:00:00+00:00"), "already reset")
        self.assertEqual(util.until("nope"), "?")

    def test_running_in(self):
        self.assertEqual(util.running_in(helpers.row(host="terminal", entry="cli")), "terminal · CLI")
        self.assertEqual(util.running_in(helpers.row(host="IntelliJ", entry="acp")), "IntelliJ · ACP plugin")


if __name__ == "__main__":
    unittest.main()
