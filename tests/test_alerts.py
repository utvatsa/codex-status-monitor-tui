"""Alert rules: context windows and their levels, memory, time-based alerts, machine-level alerts, chat files and the config writes."""
import http.client
import json
import os
import tempfile
import time
import unittest
from unittest import mock

import helpers
from cust_codex_status import config, data, footprint, health as H
from cust_codex_status.web.bridge import Hub, snapshot
from cust_codex_status.web.server import WebServer
from cust_codex_status.views import make_options


class Isolated(unittest.TestCase):
    """Every test gets its own empty config file and CODEX home."""
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.patches = [mock.patch.object(config, "USER_CONFIG", os.path.join(self.tmp, "cfg", "config.json")),
                        mock.patch.object(config, "CODEX", os.path.join(self.tmp, ".codex")),
                        mock.patch.object(data, "CODEX", os.path.join(self.tmp, ".codex")), mock.patch.object(data, "ps_table", return_value={})]
        for p in self.patches:
            p.start()
        footprint._cache.clear()

    def tearDown(self):
        for p in self.patches:
            p.stop()


class WindowTests(Isolated):
    def test_resolution_order_and_source(self):
        W = data.window_for
        self.assertEqual(W("gpt-x", 1000), (258_400, "guess"))
        self.assertEqual(W("gpt-x", 1000, None, 272_000), (272_000, "reported"))          # what the rollout says
        self.assertEqual(W("gpt-x", 300_000), (1_000_000, "evidence"))                    # a turn above the guess proves a bigger window
        config.set_window("gpt-x", "500k")
        self.assertEqual(W("gpt-x", 1000, None, 272_000), (500_000, "config"))            # your model setting beats the report
        sid = "01a181c7-4172-7e80-8b1b-4ddff7424577"
        config.set_chat(sid, "1m")
        self.assertEqual(W("gpt-x", 1000, sid), (1_000_000, "chat"))                      # what you set for a chat beats the model setting
        self.assertEqual(W("gpt-x", 1000, sid[:8] + "-0000-7000-8000-000000000000"), (500_000, "config"))   # same 8-char prefix, other chat: untouched
        self.assertEqual(W("gpt-x", 1000, "99999999-aaaa"), (500_000, "config"))

    def test_config_wins_over_the_built_in_table(self):
        config.set_window("terra", "200k")
        self.assertEqual(data.window_for("gpt-5.6-terra", 1000, None, 258_400), (200_000, "config"))

    def test_bad_sizes_are_refused(self):
        for bad in ("abc", "5", "99m", ""):
            with self.assertRaises(ValueError):
                config.set_window("gpt-x", bad)
        with self.assertRaises(ValueError):
            config.set_window("", "1m")
        self.assertEqual(config.window_overrides(), {})

    def test_parse_size(self):
        self.assertEqual([config.parse_size(x) for x in ("1m", "200k", "1.5m", 500_000, "bad")], [1_000_000, 200_000, 1_500_000, 500_000, None])


class ContextRuleTests(Isolated):
    def test_levels_follow_the_window_size(self):
        small = helpers.row(ctx=170_000, window=200_000)               # 85%
        big = helpers.row(ctx=600_000, window=1_000_000)               # 60%
        self.assertEqual((H.health(small)[0], H.health(big)[0]), ("AMBER", "AMBER"))
        self.assertEqual(H.health(helpers.row(ctx=590_000, window=1_000_000))[0], "OK")
        self.assertEqual(H.health(helpers.row(ctx=900_000, window=1_000_000))[0], "RED")
        self.assertEqual(H.health(helpers.row(ctx=190_000, window=1_000_000))[0], "OK")    # the reported bug: 190k of a 1M chat is fine

    def test_user_levels_apply_without_a_restart(self):
        r = helpers.row(ctx=700_000, window=1_000_000)
        self.assertEqual(H.health(r)[0], "AMBER")
        config.set_context("1m", 75, 95)
        self.assertEqual(H.health(r)[0], "OK")

    def test_set_context_validates(self):
        for args in (("2m", 50, 60), ("1m", 90, 80), ("1m", 0, 50), ("1m", 50, 101)):
            with self.assertRaises(ValueError):
                config.set_context(*args)

    def test_unknown_or_wrong_typed_alert_keys_are_ignored(self):
        config.save_config(dict(alerts=dict(context="nope", memory=dict(chat_mb="x", bogus=1))))
        self.assertEqual(config.alert_rules(), config.DEFAULT_RULES)


class MemoryAndTimeTests(Isolated):
    def test_one_chat_memory_levels(self):
        self.assertEqual([H.health(helpers.row(mem_mb=m))[0] for m in (400, 1500, 2999, 3000)], ["OK", "AMBER", "AMBER", "RED"])
        self.assertIn("using 1.8 GB of memory", H.health(helpers.row(mem_mb=1800))[1])

    def test_idle_needs_the_memory_floor(self):
        old = time.time() - 7200
        self.assertEqual(H.health(helpers.row(last_run=old, mem_mb=100))[0], "OK")
        self.assertEqual(H.health(helpers.row(last_run=old, mem_mb=300))[0], "AMBER")

    def test_waiting_shows_how_long(self):
        r = helpers.row(waiting="Bash", status_since=time.time() - 14 * 60)
        self.assertIn("(Bash) for 14m", H.health(r)[1][0])
        self.assertNotIn(" for ", H.health(helpers.row(waiting="Bash", status_since=time.time() - 30))[1][0])

    def test_busy_with_no_output_is_flagged(self):
        stuck = helpers.row(state="busy", last_run=time.time() - 45 * 60)
        self.assertEqual(H.health(stuck)[0], "AMBER")
        self.assertIn("may be stuck", H.health(stuck)[1][0])
        self.assertEqual(H.health(helpers.row(state="busy", last_run=time.time() - 60))[0], "OK")
        self.assertEqual(H.health(helpers.row(state="busy", last_run=time.time() - 45 * 60, active=False))[0], "OK")


class SystemAlertTests(Isolated):
    def test_live_chats_against_ram(self):
        rows = [helpers.row(mem_mb=3000), helpers.row(mem_mb=2000, name="b"), helpers.row(mem_mb=900, active=False)]
        def levels(ram):
            return [(x["kind"], x["level"]) for x in H.system_alerts(rows, ram=ram, disk_free=10 ** 12)]
        self.assertEqual(levels(25 * 10 ** 9), [])                       # 5 GB of 25 GB = 20%
        self.assertEqual(levels(16 * 10 ** 9), [("memory", "AMBER")])    # 31%
        self.assertEqual(levels(12 * 10 ** 9), [("memory", "RED")])      # 42%; archived chats do not count

    def test_disk_free(self):
        low = H.system_alerts([], ram=0, disk_free=8 * 10 ** 9)
        self.assertEqual([(x["kind"], x["level"]) for x in low], [("disk", "AMBER")])
        self.assertEqual(H.system_alerts([], ram=0, disk_free=2 * 10 ** 9)[0]["level"], "RED")
        self.assertEqual(H.system_alerts([], ram=0, disk_free=50 * 10 ** 9), [])


class FootprintTests(Isolated):
    SID = "01a181c7-4172-7e80-8b1b-4ddff7424577"

    def make_chat(self, sid=SID, scratch_mb=30):
        codex = os.path.join(self.tmp, ".codex")
        day = os.path.join(codex, "sessions", "2026", "10", "28")
        os.makedirs(day)
        t = os.path.join(day, f"rollout-2026-10-28T14-41-21-{sid}.jsonl")
        with open(t, "w") as f:
            f.write("x" * 1000)
        viz = os.path.join(codex, "visualizations", "2026", "10", "28", sid)
        os.makedirs(viz)
        with open(os.path.join(viz, "big.png"), "wb") as f:
            f.write(b"y" * scratch_mb * 10 ** 6)
        os.makedirs(os.path.join(codex, "shell_snapshots"))
        with open(os.path.join(codex, "shell_snapshots", f"{sid}.1793190480350442000.sh"), "w") as f:
            f.write("z" * 500)
        return t

    def test_parts_and_total(self):
        t = self.make_chat()
        fp = footprint.footprint(self.SID, t)
        self.assertEqual(fp["parts"]["transcript"], 1000)
        self.assertEqual(fp["parts"]["visualizations"], 30 * 10 ** 6)
        self.assertEqual(fp["parts"]["shell_snapshots"], 500)
        self.assertEqual(fp["total"], 1500 + 30 * 10 ** 6)

    def test_missing_files_and_symlinks_are_harmless(self):
        t = self.make_chat()
        os.symlink("/etc", os.path.join(self.tmp, ".codex", "visualizations", "2026", "10", "28", self.SID, "link"))
        fp = footprint.footprint(self.SID, t)
        self.assertEqual(fp["parts"]["visualizations"], 30 * 10 ** 6)
        self.assertEqual(footprint.footprint("nothing", None)["total"], 0)

    def test_old_ended_chat_gets_delete_and_archive_advice(self):
        t = self.make_chat()
        fp = footprint.footprint(self.SID, t)
        r = helpers.row(active=False, state="ended", last_active=time.time() - 10 * 86400, session_id=self.SID)
        kinds = {a["kind"]: a for a in footprint.advice(r, fp)}
        self.assertEqual(set(kinds), {"delete-scratch", "archive"})
        self.assertTrue(kinds["delete-scratch"]["command"].startswith("rm -rf "))
        self.assertNotIn(".jsonl", kinds["delete-scratch"]["command"])                # the rollout is never in the command
        self.assertIn(self.SID, kinds["delete-scratch"]["command"])

    def test_recent_or_live_chats_get_no_cleanup_advice(self):
        t = self.make_chat()
        fp = footprint.footprint(self.SID, t)
        self.assertEqual(footprint.advice(helpers.row(active=False, last_active=time.time() - 3600), fp), [])
        self.assertEqual(footprint.advice(helpers.row(active=True, last_active=time.time() - 30 * 86400), fp), [])

    def test_snapshot_carries_files_window_and_advice(self):
        t = self.make_chat()
        r = helpers.row(session_id=self.SID, transcript=t, model="gpt-x", window_source="guess", ctx=180_000,
                        window=200_000, active=False, state="ended", last_active=time.time() - 9 * 86400)
        s = snapshot(([r], 0, {}, {}), make_options())["sessions"][0]
        self.assertGreater(s["files"]["total_mb"], 29)
        self.assertEqual(s["files"]["parts"][0][0], "visualizations")
        self.assertEqual({a["kind"] for a in s["advice"]}, {"delete-scratch", "archive"})
        self.assertEqual(s["window_source"], "guess")
        self.assertEqual((s["ctx_amber"], s["ctx_red"]), ("170.0k", "190.0k"))
        o = s["window_offer"]
        self.assertEqual((o["sid"], o["size"], o["command"]), (self.SID, "1m", "cust-codex-status --set-window 01a181c7-4172 1m"))

    def test_no_window_offer_when_the_window_is_known(self):
        for src in ("default", "config", "evidence", "name"):
            r = helpers.row(model="gpt-x", window_source=src, ctx=190_000, window=200_000)
            self.assertIsNone(snapshot(([r], 0, {}, {}), make_options())["sessions"][0]["window_offer"], src)


class PerChatTests(Isolated):
    def test_suggested_levels(self):
        S = config.suggest_levels
        self.assertEqual([S(w) for w in (100_000, 200_000, 400_000, 600_000, 1_000_000, 2_000_000)],
                         [(85, 95), (85, 95), (74, 93), (68, 92), (60, 90), (49, 88)])
        for w in range(50_000, 3_000_000, 50_000):
            a, r = S(w)
            self.assertTrue(20 <= a and a + 5 <= r <= 99, w)

    def test_set_chat_with_and_without_levels(self):
        config.set_chat("3196cae4-7b9d", "600k")
        r = helpers.row(session_id="3196cae4-7b9d", window=600_000, ctx=420_000)             # 70%: amber from the suggested 68%
        self.assertEqual(H.ctx_levels(r), (68, 92))
        self.assertEqual(H.health(r)[0], "AMBER")
        config.set_chat("3196cae4-7b9d", "600k", 80, 95)
        self.assertEqual(H.ctx_levels(r), (80, 95))
        self.assertEqual(H.health(r)[0], "OK")
        self.assertEqual(H.ctx_levels(helpers.row(session_id="12345678-aaaa", window=600_000)), (68, 92))      # other chats unaffected
        config.clear_chat("3196cae4-7b9d")
        self.assertEqual((config.window_overrides(), config.chat_levels("3196cae4-7b9d")), ({}, None))

    def test_bad_chat_settings_are_refused(self):
        for args in (("short", "1m"), ("3196cae4", "huge"), ("3196cae4", "1m", 90, 80), ("3196cae4", "1m", 50)):
            with self.assertRaises(ValueError):
                config.set_chat(*args)
        self.assertFalse(os.path.exists(config.USER_CONFIG))

    def test_target_kinds(self):
        self.assertTrue(config.is_chat_id("3196cae4") and config.is_chat_id("3196cae4-7b9d-4ef8"))
        self.assertFalse(config.is_chat_id("opus-5-5") or config.is_chat_id("haiku-5-5"))


class PruneTests(Isolated):
    DAY = 86400

    def age(self, key, days):
        d = config.user_config()
        d["chat_set"][key] = time.time() - days * self.DAY
        config.save_config(d)

    def transcript(self, key, days_old):
        p = os.path.join(self.tmp, ".codex", "sessions", "2026", "10", "25", f"rollout-2026-10-25T00-00-00-{key}-0000.jsonl")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "w").write("x")
        t = time.time() - days_old * self.DAY
        os.utime(p, (t, t))

    def test_setting_a_chat_stamps_it_and_clearing_removes_the_stamp(self):
        config.set_chat("aaaaaaaa-1111", "600k")
        self.assertIn("aaaaaaaa-1111", config.user_config()["chat_set"])
        config.clear_chat("aaaaaaaa-1111")
        self.assertEqual((config.user_config()["chat_set"], config.window_overrides()), ({}, {}))

    def test_old_setting_of_a_quiet_or_missing_chat_is_pruned_on_the_next_write(self):
        config.set_chat("aaaaaaaa-1111", "600k", 70, 90)
        self.age("aaaaaaaa-1111", 120)                                       # old, and no transcript at all
        config.set_chat("bbbbbbbb-2222", "1m")
        d = config.user_config()
        self.assertEqual(sorted(d["windows"]), ["bbbbbbbb-2222"])
        self.assertEqual((d["chat_levels"], sorted(d["chat_set"])), ({}, ["bbbbbbbb-2222"]))

    def test_old_setting_of_a_chat_that_is_still_in_use_is_kept(self):
        config.set_chat("aaaaaaaa-1111", "600k")
        self.age("aaaaaaaa-1111", 120)
        self.transcript("aaaaaaaa-1111", 5)                                  # resumed 5 days ago
        config.set_chat("bbbbbbbb-2222", "1m")
        self.assertEqual(sorted(config.window_overrides()), ["aaaaaaaa-1111", "bbbbbbbb-2222"])

    def test_young_settings_model_ids_and_unstamped_legacy_entries_are_never_pruned(self):
        config.save_config(dict(windows={"opus-5-5": 1_000_000, "cccccccc": 500_000}, chat_levels={}))     # written before stamps existed
        config.set_chat("aaaaaaaa-1111", "600k")
        d = config.user_config()
        self.assertEqual(sorted(d["windows"]), ["aaaaaaaa-1111", "cccccccc", "opus-5-5"])
        self.assertIsInstance(d["chat_set"]["cccccccc"], float)         # stamped now, so it ages from today
        self.age("cccccccc", 120)
        config.set_chat("bbbbbbbb-2222", "1m")
        self.assertEqual(sorted(config.window_overrides()), ["aaaaaaaa-1111", "bbbbbbbb-2222", "opus-5-5"])      # now old and quiet: gone, model id stays


class MachineAlertTests(Isolated):
    def test_memory_alert_names_the_biggest_chats(self):
        rows = [helpers.row(session_id=f"s{i}", name=f"c{i}", mem_mb=m) for i, m in enumerate((500, 3000, 2000, 100))]
        a = H.system_alerts(rows, ram=12 * 10 ** 9, disk_free=10 ** 12)[0]
        self.assertEqual([c["label"] for c in a["culprits"]], ["c1", "c2", "c0", "c3"])
        self.assertEqual(a["culprits"][0], dict(sid="s1", label="c1", mem_mb=3000))

    def test_disk_alert_says_what_old_chats_could_free(self):
        sid = "01a181c7-4172-7e80-8b1b-4ddff7424577"
        proj = os.path.join(self.tmp, ".codex", "sessions", "2026", "10", "28")
        viz = os.path.join(self.tmp, ".codex", "visualizations", "2026", "10", "28", sid)
        os.makedirs(proj)
        os.makedirs(viz)
        open(os.path.join(proj, f"rollout-x-{sid}.jsonl"), "w").write("x")
        open(os.path.join(viz, "big"), "wb").write(b"y" * 30 * 10 ** 6)
        r = helpers.row(session_id=sid, transcript=os.path.join(proj, f"rollout-x-{sid}.jsonl"), active=False, state="ended", last_active=time.time() - 9 * 86400)
        with mock.patch("cust_codex_status.health.shutil.disk_usage", return_value=mock.Mock(free=5 * 10 ** 9)):
            s = snapshot(([r], 0, {}, {}), make_options())["system"]
        disk = [x for x in s if x["kind"] == "disk"][0]
        self.assertEqual((disk["reclaim_mb"], disk["reclaim_chats"]), (30.0, [sid]))


class ConfigEndpointTests(Isolated):
    def setUp(self):
        super().setUp()
        self.hub = Hub("tui")
        self.srv = WebServer(self.hub, port=0, idle=0).start()
        self.port = self.srv.httpd.server_address[1]

    def tearDown(self):
        self.srv.stop()
        super().tearDown()

    def post(self, body, origin="same"):
        h = {"Content-Type": "application/json"}
        if origin == "same":
            h["Origin"] = f"http://127.0.0.1:{self.port}"
        elif origin:
            h["Origin"] = origin
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.request("POST", "/api/config", body=json.dumps(body).encode(), headers=h)
        r = c.getresponse()
        out = (r.status, r.read())
        c.close()
        return out

    def test_the_page_sets_one_chat_and_the_owner_is_asked_to_refresh(self):
        self.assertEqual(self.post(dict(chat=dict(sid="3196cae4-7b9d", window="600k")))[0], 200)
        self.assertEqual(config.window_overrides(), {"3196cae4-7b9d": 600_000})
        self.assertTrue(self.hub.take_refresh())
        self.assertEqual(self.post(dict(chat=dict(sid="3196cae4-7b9d", window="600k", amber=70, red=90)))[0], 200)
        self.assertEqual(config.chat_levels("3196cae4-7b9d"), (70, 90))
        self.assertEqual(self.post(dict(chat=dict(sid="3196cae4-7b9d", clear=True)))[0], 200)
        self.assertEqual(config.window_overrides(), {})

    def test_the_page_can_never_change_model_wide_or_tool_wide_settings(self):
        for body in (dict(window=dict(model="opus-5-5", size="1m")), dict(context=dict(window="1m", amber=65, red=92)),
                     dict(alerts={"memory": {"chat_mb": [1, 2]}}), dict(web=False), {}):
            self.assertEqual(self.post(body)[0], 400, body)
        self.assertFalse(os.path.exists(config.USER_CONFIG))

    def test_bad_chat_values_change_nothing(self):
        for chat in (dict(sid="3196cae4", window="huge"), dict(sid="abc", window="1m"), dict(sid="3196cae4", window="1m", amber=99, red=50),
                     dict(sid="3196cae4", window="1m", amber=60), dict(sid=5, window="1m")):
            self.assertEqual(self.post(dict(chat=chat))[0], 400, chat)
        self.assertFalse(os.path.exists(config.USER_CONFIG))

    def test_cross_origin_is_refused(self):
        self.assertEqual(self.post(dict(chat=dict(sid="3196cae4", window="1m")), origin="http://evil.example")[0], 403)
        self.assertFalse(os.path.exists(config.USER_CONFIG))


if __name__ == "__main__":
    unittest.main()
