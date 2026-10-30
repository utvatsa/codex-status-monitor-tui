import time
import unittest

import helpers
from cust_codex_status import health as H


def ctx(pct):
    return dict(ctx=pct * 2000, window=200_000)


class HealthTests(unittest.TestCase):
    def test_context_thresholds(self):
        self.assertEqual([H.health(helpers.row(**ctx(p)))[0] for p in (0, 84, 85, 94, 95, 100)],
                         ["OK", "OK", "AMBER", "AMBER", "RED", "RED"])

    def test_codex_window_sizes_use_the_200k_levels(self):
        for w in (200_000, 258_400, 272_000):                          # Codex's usual windows sit in the 200k class
            self.assertEqual(H.ctx_levels(helpers.row(window=w)), (85, 95), w)
        self.assertEqual(H.ctx_levels(helpers.row(window=1_000_000)), (60, 90))
        self.assertEqual(H.health(helpers.row(window=258_400, ctx=230_000))[0], "AMBER")

    def test_a_shared_server_chat_without_a_memory_figure_is_never_a_memory_problem(self):
        r = helpers.row(mem_mb=None, last_run=time.time() - 7200)
        self.assertEqual(H.health(r), ("OK", []))

    def test_reason_text(self):
        self.assertEqual(H.health(helpers.row(**ctx(90)))[1], ["context 90% full"])
        self.assertIn("when it ended", H.health(helpers.row(active=False, **ctx(90)))[1][0])

    def test_waiting_on_prompt_is_amber_and_never_downgrades_red(self):
        self.assertEqual(H.health(helpers.row(waiting="tool call: shell"))[0], "AMBER")
        self.assertEqual(H.health(helpers.row(waiting="Bash", **ctx(97)))[0], "RED")

    def test_waiting_reason_says_approval(self):
        self.assertIn("waiting on approval (tool call: shell)", H.health(helpers.row(waiting="tool call: shell"))[1][0])

    def test_long_idle_is_amber_only_for_live_chats(self):
        old = time.time() - 2 * 3600
        self.assertEqual(H.health(helpers.row(last_run=old, mem_mb=300))[0], "AMBER")
        self.assertEqual(H.health(helpers.row(last_run=old, mem_mb=300, state="busy"))[0], "AMBER")      # busy and silent: may be stuck
        self.assertEqual(H.health(helpers.row(last_run=old, state="busy"))[0], "AMBER")
        self.assertEqual(H.health(helpers.row(last_run=old, active=False, state="ended"))[0], "OK")

    def test_healthy_chat_has_no_reasons_and_no_tips(self):
        r = helpers.row()
        self.assertEqual(H.health(r), ("OK", []))
        self.assertEqual(H.tips(r), [])

    def test_tips_follow_the_reasons(self):
        r = helpers.row(waiting="Bash", last_run=time.time() - 7200, mem_mb=300, **ctx(90))
        self.assertEqual(len(H.tips(r)), 3)

    def test_warnings_include_limits_and_live_chats_only(self):
        rows = [helpers.row(name="needs-me", **ctx(90)), helpers.row(name="fine"), helpers.row(name="old", active=False, **ctx(99))]
        w = H.warnings_for(rows, [dict(kind="weekly_all", percent=81, resets_at="2999-01-01T00:00:00+00:00"), dict(kind="session", percent=5)])
        self.assertEqual(len(w), 2)
        self.assertTrue(w[0].startswith("weekly all limit at 81%"))
        self.assertIn("needs-me", w[1])


if __name__ == "__main__":
    unittest.main()
