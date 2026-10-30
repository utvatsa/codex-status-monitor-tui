import unittest
from unittest import mock

import helpers
from cust_codex_status import render, tui, views
from cust_codex_status.util import C

C.on = False
SID_A, SID_B = "a" * 8 + "-0000-0000-0000-000000000001", "b" * 8 + "-0000-0000-0000-000000000002"
ROWS = [helpers.row(name="one", session_id=SID_A), helpers.row(name="two", session_id=SID_B)]


def draw(rows=None, **kw):
    items = []
    opts = views.make_options(**kw)
    for k, v in kw.items():
        setattr(opts, k, v)
    return render.render_ui(rows or ROWS, {}, {}, opts, 0, items).split("\n"), items


LINES, ITEMS = draw()


class TuiHelperTests(unittest.TestCase):
    def test_parse_ansi_colours_and_resets(self):
        segs = tui.parse_ansi("a\x1b[1;30;43mB\x1b[0mc")
        self.assertEqual(segs, [("a", None, None, False, False), ("B", 0, 3, True, False), ("c", None, None, False, False)])
        self.assertEqual(tui.parse_ansi("\x1b[90mdim\x1b[0m")[0], ("dim", None, None, False, True))
        self.assertEqual(tui.parse_ansi("\x1b[1;97;41mX")[0][1:3], (7, 1))

    def test_parse_ansi_reads_256_colours_and_bright_colours(self):
        segs = tui.parse_ansi("\x1b[1;38;5;233;48;5;171m OK \x1b[0m\x1b[38;5;245mdim\x1b[0m\x1b[95mhi")
        self.assertEqual(segs[0], (" OK ", 233, 171, True, False))
        self.assertEqual(segs[1], ("dim", 245, None, False, False))
        self.assertEqual(segs[2], ("hi", 5, None, True, False))             # bright magenta = magenta, bold

    def test_items_are_found_in_coloured_output_too(self):
        old = C.depth
        try:
            for depth in (256, 8):
                C.on, C.depth = True, depth
                for kw in ({}, {"compact": True}):
                    lines, items = draw(**kw)
                    self.assertEqual(len(tui.item_spans(lines)), 2, f"{depth} {kw}")
        finally:
            C.on, C.depth = False, old

    def test_cards_become_items_with_resume_commands(self):
        spans = tui.item_spans(LINES)
        self.assertEqual(len(spans), 2)
        self.assertEqual([it["sid"] for it in ITEMS], [SID_A, SID_B])
        self.assertEqual(ITEMS[0]["resume"], f"cd ~/proj && codex resume {SID_A}")
        self.assertEqual(ITEMS[1]["clean"], "cd ~/proj && codex")
        self.assertEqual(tui.item_at(spans, spans[1][0] + 1), 1)
        self.assertIsNone(tui.item_at(spans, 0))

    def test_compact_rows_are_items_and_expand_when_selected(self):
        lines, items = draw(compact=True)
        spans = tui.item_spans(lines)
        self.assertEqual(len(spans), 2)
        self.assertTrue(all(a == b for a, b in spans))                  # one line each while collapsed
        lines, items = draw(compact=True, expand=SID_B)
        spans = tui.item_spans(lines)
        self.assertEqual(len(spans), 2)
        a, b = spans
        self.assertEqual(a[0], a[1])                                    # the other row stays collapsed
        self.assertGreater(b[1] - b[0], 5)                              # the selected one shows folder, id, prompts, resume...
        text = "\n".join(lines[b[0]:b[1] + 1])
        self.assertIn("folder", text)
        self.assertIn(f"codex resume {SID_B}", text)

    def test_archived_rows_show_a_prompt_line_that_can_be_hidden(self):
        arc = [helpers.row(active=False, session_id=SID_A, pid=None, state="ended", name=None)]
        lines, items = draw(arc, show_arc=True, show_live=False)
        spans = tui.item_spans(lines)
        self.assertEqual(len(spans), 1)
        block = "\n".join(lines[spans[0][0]:spans[0][1] + 1])
        self.assertIn("latest prompt text", block)
        self.assertIn("codex resume", block)
        lines, _ = draw(arc, show_arc=True, show_live=False, arc_prompt=False)
        self.assertNotIn("latest prompt text", "\n".join(lines))
        lines, _ = draw(arc, show_arc=True, show_live=False, expand=SID_A)
        self.assertIn("first prompt text", "\n".join(lines))

    def test_scrolling_keeps_the_item_visible(self):
        self.assertEqual(tui.top_for_span(0, 5, 14, 30), 0)          # already visible: no scroll
        self.assertEqual(tui.top_for_span(10, 5, 14, 30), 5)         # item is above the view
        self.assertEqual(tui.top_for_span(0, 20, 34, 30), 5)         # item's end is below: scroll the least needed
        self.assertEqual(tui.top_for_span(0, 5, 100, 30), 5)         # taller than the screen: first line at the top

    def test_level_keys(self):
        self.assertEqual([tui.step_level(75, k) for k in "12345"], [10, 30, 60, 75, 95])
        self.assertEqual((tui.step_level(75, "+"), tui.step_level(75, "-"), tui.step_level(95, "+"), tui.step_level(10, "-")), (95, 60, 95, 10))

    def test_interval_steps(self):
        self.assertEqual((tui.step_interval(5, True), tui.step_interval(10, True), tui.step_interval(5, False), tui.step_interval(1, False),
                          tui.step_interval(300, True)), (6, 15, 4, 1, 300))

    def test_escape_unselects_first_then_needs_a_second_press_to_quit(self):
        self.assertEqual(tui.esc_action(True, None, 100.0), "back")
        self.assertEqual(tui.esc_action(False, None, 100.0), "warn")
        self.assertEqual(tui.esc_action(False, 100.0, 101.0), "quit")
        self.assertEqual(tui.esc_action(False, 100.0, 100.0 + tui.ESC_WINDOW + 1), "warn")

    def test_footer_always_has_a_back_button_when_selected(self):
        nav, sel = tui.help_items(False, 75, 5), tui.help_items(True, 75, 5)
        self.assertEqual(sel[0][3], "back")
        self.assertIn("BACK", sel[0][1])
        self.assertEqual(nav[0][1].split()[0], "SELECT")
        for items in (nav, sel):
            text = " ".join(f"{k} {d}" for k, d, _, _ in items)
            self.assertIn("+ / -", text)
            self.assertNotIn("⌘", text)                               # Cmd+/- never reaches a terminal program

    def test_footer_is_short_by_default_and_m_shows_everything(self):
        for selected in (False, True):
            short, full = tui.help_items(selected, 75, 5), tui.help_items(selected, 75, 5, more=True)
            self.assertLessEqual(len(short), 8)
            self.assertEqual(short[-1][0], "m")
            self.assertIn("MORE", short[-1][1])
            self.assertEqual(full[-1][0], "m")
            self.assertIn("fewer", full[-1][1])
            self.assertGreater(len(full), len(short) + 5)
            keys = [k for k, _, _, _ in full]
            self.assertEqual(len(keys), len(set(keys)))               # no key listed twice
            for needed in ("t", "c", "p", "v", "r", "Ctrl-L", "1-5", "q" if selected else "Esc Esc / q", "a" if not selected else "i"):
                self.assertIn(needed, keys)

    def test_footer_layout_fits_the_screen_and_degrades_to_one_per_line(self):
        items = tui.help_items(False, 75, 5)
        for width, rows in ((200, 6), (118, 6), (60, 14), (30, 14)):
            placed, used = tui.layout_help(items, width, rows)
            self.assertTrue(placed)
            self.assertLessEqual(used, rows)
            for row, x, (k, d, _, _) in placed:
                self.assertLess(x + len(k) + 4 + len(d), width + 1 if width >= 60 else 10_000)
        placed, used = tui.layout_help(items, 30, 14)
        self.assertEqual(len({r for r, _, _ in placed}), len(placed))      # one item per line on a narrow screen
        wide, _ = tui.layout_help(items, 200, 12)
        self.assertGreater(max(x for _, x, _ in wide), 0)                  # several columns on a wide one

    def test_copy_uses_pbcopy_and_reports(self):
        with mock.patch.object(tui.subprocess, "run") as run:
            msg = tui.copy_resume("cd ~ && codex resume x", "#1 one")
            tui.copy_text("abc", "session id")
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args_list[0].kwargs["input"], b"cd ~ && codex resume x")
        self.assertIn("✔ copied the RESUME command of #1 one", msg)
        self.assertEqual(tui.copy_resume(None), "nothing to copy (RESUME command)")
        with mock.patch.object(tui.subprocess, "run", side_effect=OSError):
            self.assertIn("failed", tui.copy_text("x", "id"))


if __name__ == "__main__":
    unittest.main()
