import time
import unittest

import helpers
from cust_codex_status import render, views
from cust_codex_status.util import C, vlen

USAGE = dict(fetchedAtMs=int(time.time() * 1000), utilization=dict(limits=[
    dict(kind="session", percent=4, resets_at="2999-01-01T00:00:00+00:00"),
    dict(kind="weekly_all", percent=27, resets_at="2999-01-01T00:00:00+00:00", is_active=True)]))
ROWS = [helpers.row(name="ok-chat", session_id="a" * 8 + "-0000-0000-0000-000000000001"),
        helpers.row(name="amber-chat", session_id="b" * 8 + "-0000-0000-0000-000000000002", ctx=178_000, waiting=None, last_run=time.time() - 9000),
        helpers.row(name="red-chat", session_id="c" * 8 + "-0000-0000-0000-000000000003", ctx=196_000),
        helpers.row(name="", title="Old archived chat", active=False, state="ended", pid=None, mem_mb=None, ctx=190_000, host=None,
                    session_id="d" * 8 + "-0000-0000-0000-000000000004")]


def report(level, **kw):
    C.on = False
    return render.render_ui(ROWS, dict(email="me@example.com", plan="max"), USAGE, views.make_options(level=level, **kw), hidden=2)


class RenderTests(unittest.TestCase):
    def test_limits_use_their_own_label_and_flag_stale_numbers(self):
        C.on = False
        old = dict(fetchedAtMs=int((time.time() - 7200) * 1000), utilization=dict(limits=[
            dict(kind="window_1440", label="1-day", percent=50, resets_at="2999-01-01T00:00:00+00:00", is_active=True)]))
        text = render.render_ui(ROWS, dict(email="me@example.com"), old, views.make_options(level=75), hidden=0)
        self.assertIn("1-day", text)
        self.assertIn("STALE", text)
        self.assertNotIn("STALE", report(75))

    def test_tokens_are_shown_instead_of_cost(self):
        text = report(75)
        self.assertIn("reasoning 5", text)
        self.assertNotIn("cost", text)
        self.assertNotIn("$", text)

    def test_every_level_renders_within_the_width_cap(self):
        for level in (0, 10, 19, 20, 44, 45, 69, 70, 75, 89, 90, 100):
            text = report(level)
            self.assertLessEqual(max(vlen(l) for l in text.split("\n")), 118, f"level {level}")
            self.assertIn("CODEX ▸ status", text)

    def test_health_badges_and_counts(self):
        text = report(75)
        self.assertIn("live health  [OK] 1   [AMBER] 1   [RED] 1", text)
        for word in ("┃  OK   ┃", "┃ AMBER ┃", "┃  RED  ┃"):
            self.assertIn(word, text)
        self.assertIn("context 98% full", text)

    def test_minimal_has_no_usage_panel_or_legend(self):
        text = report(10)
        self.assertNotIn("usage limits", text)
        self.assertNotIn("nothing to do", text)
        self.assertEqual(text.count("● idle"), 3)

    def test_compact_has_usage_and_one_line_per_chat(self):
        text = report(30)
        self.assertIn("usage limits", text)
        self.assertIn("weekly · all models", text)
        self.assertNotIn("resume cd", text)

    def test_lean_cards_drop_folder_and_clean(self):
        text = report(60)
        self.assertIn("resume cd ~/proj", text)
        self.assertNotIn("folder ~/proj", text)
        self.assertNotIn("clean ", text)

    def test_standard_hides_prompts_full_shows_them_and_archived(self):
        std, full = report(75), report(95)
        self.assertNotIn("first prompt text", std)
        self.assertNotIn("archived threads", std)
        self.assertIn("first prompt text", full)
        self.assertIn("archived threads", full)
        self.assertIn("▲ context 95% full when it ended", full)
        self.assertIn("2 older archived chat(s) not shown", full)

    def test_view_hint_names_the_level(self):
        self.assertIn("view: standard (level 75)", report(75))
        self.assertIn("view: minimal (level 10)", report(10))

    def test_account_flag_adds_details(self):
        self.assertIn("sign-in", report(75, account=True))
        self.assertNotIn("sign-in", report(75))

    def test_cards_are_numbered_and_separated(self):
        text = report(75)
        for n in (1, 2, 3):
            self.assertRegex(text, rf"┏━▍{n} ▸ ")
        self.assertIn("┄" * 20, text)

    def test_colour_mode_uses_ansi_badges(self):
        old = C.depth
        try:
            C.on, C.depth = True, 256
            text = render.render_ui(ROWS, {}, USAGE, views.make_options(), 0)
            self.assertIn("\x1b[1;38;5;233;48;5;214m", text)      # AMBER: ink on an amber block
            self.assertIn("\x1b[1;38;5;233;48;5;203m", text)      # RED: ink on a red block
            self.assertIn("38;5;171", text)                       # orchid primary
            self.assertNotIn("36m", text.replace("\x1b[0m", ""))   # no cyan
            C.depth = 8
            text = render.render_ui(ROWS, {}, USAGE, views.make_options(), 0)
            self.assertIn("\x1b[1;30;43m", text)                  # 8 colours: black on yellow
            self.assertNotIn("38;5;", text)
        finally:
            C.on, C.depth = False, old

    def test_colour_and_plain_output_have_the_same_layout(self):
        old = C.depth
        try:
            for depth in (256, 8):
                for level in (10, 30, 60, 75, 95):
                    C.on = False
                    plain = report(level).split("\n")
                    C.on, C.depth = True, depth
                    # the time stamp and ages differ by a second at most, so compare the shape: visible width of every line
                    coloured = render.render_ui(ROWS, dict(email="me@example.com", plan="max"), USAGE, views.make_options(level=level), hidden=2).split("\n")
                    self.assertEqual([vlen(l) for l in coloured], [vlen(l) for l in plain], f"depth {depth} level {level}")
        finally:
            C.on, C.depth = False, old

    def test_no_colour_output_has_no_escape_codes(self):
        for level in (0, 50, 100):
            self.assertNotIn("\x1b", report(level))

    def test_header_is_a_tile_strip_not_a_boxed_summary(self):
        text = report(75)
        for label in ("THREADS", "CACHE HIT", "REASONING", "TOKENS / TURN", "RATE LIMIT"):
            self.assertIn(label, text)
        self.assertRegex(text, r"CONTEXT HEADROOM|HEADROOM")
        self.assertNotIn("memory held", text)
        self.assertNotIn("╭", text)                              # not the Claude edition's rounded boxes
        self.assertIn("approval", text)

    def test_small_views_use_one_line_chips_instead_of_boxes(self):
        small, big = report(10), report(75)
        self.assertNotIn("┌─▍", small)
        self.assertIn("▍THREADS", small)
        self.assertIn("┌─▍THREADS", big)

    def test_narrow_terminal_keeps_every_line_inside_the_width(self):
        from unittest import mock
        for width in (60, 72, 80, 100):
            with mock.patch.object(render, "term_width", return_value=width):
                for level in (0, 30, 60, 75, 100):
                    text = report(level)
                    self.assertLessEqual(max(vlen(l) for l in text.split("\n") if not l.lstrip().startswith(("ctx =", "view:", "2 older"))), width, f"{width}/{level}")


if __name__ == "__main__":
    unittest.main()
