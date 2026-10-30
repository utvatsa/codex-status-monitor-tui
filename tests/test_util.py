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
        self.assertEqual(util.bar(0, 4), "┄┄┄┄")
        self.assertEqual(util.bar(100, 4), "━━━━")

    def test_palette_has_no_cyan_and_health_colours_are_distinct(self):
        for name, (big, small) in util.PALETTE.items():
            self.assertNotIn(small, (36, 96), name)                       # no cyan in the 8-colour fallback
            self.assertNotIn(big, range(30, 52), name)                    # none of the 256-colour teals/cyans (30-51)
        self.assertEqual(util.PALETTE["primary"][1], 35)                  # orchid falls back to magenta
        self.assertEqual(len({util.PALETTE[k][0] for k in ("ok", "amber", "red")}), 3)

    def test_roles_follow_the_colour_depth(self):
        old = util.C.depth
        try:
            util.C.depth = 256
            self.assertEqual(util.C.code("primary"), "38;5;171")
            self.assertEqual(util.C.code("primary", bg=True), "48;5;171")
            self.assertEqual(util.C.index("secondary"), 209)
            util.C.depth = 8
            self.assertEqual(util.C.code("primary"), "35")
            self.assertEqual(util.C.code("primary", bg=True), "45")
            self.assertEqual(util.C.index("text"), -1)                    # off-white falls back to the terminal's own text colour
            util.C.on = True
            self.assertEqual(util.C.block("ok", "x"), "\x1b[1;30;42mx\x1b[0m")
        finally:
            util.C.on, util.C.depth = False, old

    def test_detect_depth(self):
        self.assertEqual(util.detect_depth({"TERM": "xterm-256color"}), 256)
        self.assertEqual(util.detect_depth({"TERM": "xterm", "COLORTERM": "truecolor"}), 256)
        self.assertEqual(util.detect_depth({"TERM": "xterm"}), 8)
        self.assertEqual(util.detect_depth({}), 8)

    def test_bar_shows_a_cell_for_any_non_zero_value_and_takes_a_tone(self):
        util.C.on = False
        self.assertEqual(util.bar(1, 10), "━" + "┄" * 9)
        self.assertEqual(util.bar(0, 10), "┄" * 10)
        util.C.on = True
        try:
            self.assertIn("38;5;171", util.bar(50, 10, "primary")) if util.C.depth >= 256 else None
        finally:
            util.C.on = False

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
