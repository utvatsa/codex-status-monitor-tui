import unittest

import helpers
from cust_codex_status import views


class ViewTests(unittest.TestCase):
    def test_level_buckets(self):
        self.assertEqual([views.level_name(n) for n in (0, 19, 20, 44, 45, 69, 70, 75, 89, 90, 100)],
                         ["minimal", "minimal", "compact", "compact", "lean", "lean", "standard", "standard", "standard", "full", "full"])

    def test_default_is_standard_without_prompts_or_archived(self):
        o = views.make_options()
        self.assertEqual((o.level, o.minimal, o.compact, o.lean, o.no_prompts, o.show_arc, o.verbose),
                         (75, False, False, False, True, False, False))

    def test_full_adds_prompts_subagents_and_archived(self):
        o = views.make_options(level=95)
        self.assertEqual((o.no_prompts, o.show_arc, o.verbose), (False, True, True))

    def test_small_levels(self):
        self.assertTrue(views.make_options(level=10).minimal)
        o = views.make_options(level=30)
        self.assertEqual((o.minimal, o.compact), (False, True))
        self.assertTrue(views.make_options(level=60).lean)

    def test_explicit_flags_add_to_the_level(self):
        o = views.make_options(level=75, compact=True, verbose=True)
        self.assertTrue(o.compact and o.verbose)
        views.apply_level(o)                      # re-applying keeps explicit flags
        self.assertTrue(o.compact and o.verbose)

    def test_level_is_clamped(self):
        self.assertEqual(views.make_options(level=500).level, 100)
        self.assertEqual(views.make_options(level=-3).level, 0)

    def test_changing_level_resets_toggles_to_the_baseline(self):
        o = views.make_options(level=75)
        o.compact = True                          # a TUI toggle
        o.level = 95
        views.apply_level(o)
        self.assertFalse(o.compact)


if __name__ == "__main__":
    unittest.main()
