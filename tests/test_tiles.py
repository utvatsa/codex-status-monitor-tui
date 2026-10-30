import unittest

import helpers
from cust_codex_status import metrics, tiles
from cust_codex_status.util import C, vlen

LIMITS = [dict(kind="session", label="5-hour session", percent=40, resets_at="2999-01-01T00:00:00+00:00"),
          dict(kind="weekly_all", label="weekly", percent=71, resets_at="2999-01-01T00:00:00+00:00")]
ROWS = [helpers.row(name="a", ctx=20_000, effort="high"), helpers.row(name="b", ctx=190_000, effort="high"), helpers.row(name="c", active=False)]
CNT = {"OK": 1, "AMBER": 0, "RED": 1}
SIX = ["THREADS", "CACHE HIT", "REASONING", "HEADROOM", "TOKENS / TURN", "RATE LIMIT"]


def lines(rows=ROWS, limits=LIMITS, width=118, compact=False, cnt=CNT):
    C.on = False
    return tiles.tile_lines(rows, limits, cnt, width, compact)


class TileTests(unittest.TestCase):
    def test_six_tiles_in_this_order(self):
        specs = tiles.build(metrics.codex_metrics(ROWS, LIMITS), CNT)
        self.assertEqual([s["label"].replace("CONTEXT ", "") for s in specs], SIX)

    def test_values_come_from_the_metrics(self):
        s = {t["label"]: t for t in tiles.build(metrics.codex_metrics(ROWS, LIMITS), CNT, [100, 200])}
        self.assertEqual((s["THREADS"]["value"], s["THREADS"]["unit"]), ("2", "live"))
        self.assertEqual(s["CACHE HIT"]["value"], "75%")
        self.assertEqual(s["REASONING"]["value"], "25%")
        self.assertEqual(s["REASONING"]["note"][1], "effort high")
        self.assertEqual((s["CONTEXT HEADROOM"]["value"], s["CONTEXT HEADROOM"]["note"][0]), ("5%", "b"))
        self.assertEqual((s["RATE LIMIT"]["value"], s["RATE LIMIT"]["unit"]), ("71%", "weekly"))      # the busiest of the two windows

    def test_empty_state_never_crashes_and_says_so(self):
        out, m = lines(rows=[], limits=[], cnt={})
        text = "\n".join(out)
        self.assertIn("no live threads", text)       # the THREADS tile says it; the others just show a dash
        self.assertIn("no limit data", text)
        self.assertEqual(m["threads"], 0)

    def test_strip_fills_the_width_exactly_at_every_size(self):
        for width in (39, 56, 60, 78, 100, 113, 114, 118):
            out, _ = lines(width=width)
            boxes = [l for l in out if l.startswith(("┌", "│", "└"))]
            self.assertTrue(boxes, width)
            self.assertEqual({vlen(l) for l in boxes}, {width}, f"width {width}")

    def test_columns_adapt_to_the_terminal(self):
        self.assertEqual([tiles.columns_for(w) for w in (118, 114, 113, 78, 57, 56, 40, 30)], [6, 6, 3, 3, 3, 2, 2, 1])
        out, _ = lines(width=118)
        self.assertEqual(sum(1 for l in out if l.startswith("┌")), 1)          # one row of six
        out, _ = lines(width=78)
        self.assertEqual(sum(1 for l in out if l.startswith("┌")), 2)          # two rows of three

    def test_compact_and_small_widths_use_chips(self):
        out, _ = lines(compact=True)
        self.assertFalse(any(l.startswith("┌") for l in out))
        self.assertIn("▍THREADS 2 live", out[0])
        out, _ = lines(width=30)
        self.assertEqual(sum(l.count("▍") for l in out), 6)
        self.assertLessEqual(max(vlen(l) for l in out), 30)

    def test_mix_line_names_approval_model_and_surface(self):
        out, _ = lines(compact=True)
        mix = out[-1]
        for word in ("approval", "model", "surface", "gpt-5.6-terra"):
            self.assertIn(word, mix)

    def test_mix_splits_onto_lines_when_it_does_not_fit(self):
        m = metrics.codex_metrics(ROWS)
        self.assertEqual(len(tiles.mix(m, 200)), 1)
        self.assertEqual(len(tiles.mix(m, 40)), 3)

    def test_sparkline_and_health_bar_helpers(self):
        self.assertEqual(tiles.spark([1, 4, 8], 10), "▁▄█")
        self.assertEqual(tiles.spark([1, 2, 3, 4], 2), "▄█")
        self.assertEqual(tiles.spark([], 5), "")
        C.on = False
        self.assertEqual(vlen(tiles.segments([(1, "ok"), (1, "amber"), (1, "red")], 10)), 10)
        self.assertEqual(tiles.segments([(0, "ok"), (0, "amber"), (0, "red")], 6), "┄┄┄┄┄┄")

    def test_no_colour_mode_has_no_escape_codes_and_colour_mode_has_the_same_width(self):
        plain, _ = lines()
        self.assertFalse(any("\x1b" in l for l in plain))
        old = C.depth
        try:
            C.on, C.depth = True, 256
            col, _ = tiles.tile_lines(ROWS, LIMITS, CNT, 118, False)
        finally:
            C.on, C.depth = False, old
        self.assertEqual([vlen(l) for l in col], [vlen(l) for l in plain])
        self.assertTrue(any("\x1b" in l for l in col))


if __name__ == "__main__":
    unittest.main()
