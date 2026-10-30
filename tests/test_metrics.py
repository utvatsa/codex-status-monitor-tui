import unittest

import helpers
from cust_codex_status import metrics


def tok(inp=0, cached=0, out=0, reasoning=0, turns=0):
    return dict(input=inp, cache_read=cached, cache_write=0, output=out, reasoning=reasoning, turns=turns)


class MetricsTests(unittest.TestCase):
    def test_no_live_chats_gives_none_not_zero_division(self):
        m = metrics.codex_metrics([])
        self.assertEqual(m["threads"], 0)
        for k in ("cache_pct", "reasoning_pct", "tokens_per_turn", "headroom_pct", "headroom_chat", "rate_limit"):
            self.assertIsNone(m[k], k)
        self.assertEqual((m["approval"], m["effort"], m["models"], m["surfaces"]), ([], [], [], []))

    def test_only_live_chats_count(self):
        rows = [helpers.row(tokens=tok(100, 300, 50, 20, 4)), helpers.row(active=False, tokens=tok(9999, 9999, 9999, 9999, 99))]
        m = metrics.codex_metrics(rows)
        self.assertEqual((m["threads"], m["turns"], m["tokens"]), (1, 4, 450))

    def test_cache_hit_is_cached_over_all_input(self):
        rows = [helpers.row(tokens=tok(100, 300, 0, 0, 1)), helpers.row(tokens=tok(100, 100, 0, 0, 1))]
        m = metrics.codex_metrics(rows)
        self.assertEqual((m["cache_pct"], m["cached"], m["fresh_input"]), (67, 400, 200))      # 400 / 600

    def test_reasoning_is_a_share_of_output(self):
        m = metrics.codex_metrics([helpers.row(tokens=tok(0, 0, 200, 50, 1))])
        self.assertEqual((m["reasoning_pct"], m["reasoning"], m["output"]), (25, 50, 200))
        self.assertIsNone(metrics.codex_metrics([helpers.row(tokens=tok(10, 0, 0, 0, 1))])["reasoning_pct"])

    def test_tokens_per_turn_uses_input_cached_and_output(self):
        m = metrics.codex_metrics([helpers.row(tokens=tok(100, 300, 100, 0, 5))])
        self.assertEqual(m["tokens_per_turn"], 100)
        self.assertIsNone(metrics.codex_metrics([helpers.row(tokens=tok(10, 0, 10, 0, 0))])["tokens_per_turn"])

    def test_headroom_is_the_tightest_chat_with_its_health_level(self):
        rows = [helpers.row(name="roomy", ctx=20_000), helpers.row(name="tight", ctx=196_000), helpers.row(name="mid", ctx=100_000)]
        m = metrics.codex_metrics(rows)
        self.assertEqual((m["headroom_pct"], m["headroom_chat"], m["headroom_level"]), (2, "tight", "RED"))
        self.assertEqual(metrics.codex_metrics([helpers.row(ctx=100_000)])["headroom_level"], "OK")

    def test_mix_counts_most_common_first(self):
        rows = [helpers.row(approval="never", effort="high"), helpers.row(approval="on-request", effort="high"), helpers.row(approval="on-request", effort="low"),
                helpers.row(approval=None, model="gpt-x", host="VS Code", entry="vscode")]
        m = metrics.codex_metrics(rows)
        self.assertEqual(m["approval"][0], ("on-request", 2))
        self.assertIn(("default", 1), m["approval"])
        self.assertEqual(m["effort"], [("high", 2), ("low", 1)])
        self.assertEqual(m["models"][0], ("gpt-5.6-terra", 3))
        self.assertEqual(sum(n for _, n in m["surfaces"]), 4)

    def test_rate_limit_is_the_busiest_window(self):
        limits = [dict(kind="session", label="5-hour", percent=40, resets_at="a"), dict(kind="weekly_all", label="weekly", percent=71, resets_at="b")]
        self.assertEqual(metrics.codex_metrics([], limits)["rate_limit"], dict(label="weekly", percent=71, resets_at="b"))
        self.assertIsNone(metrics.busiest_limit([]))


if __name__ == "__main__":
    unittest.main()
