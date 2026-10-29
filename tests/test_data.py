import json
import os
import sqlite3
import tempfile
import time
import unittest
from unittest import mock

import helpers
from cust_codex_status import data

SID = "01a00000-0000-7000-8000-000000000000"


class ParsingTests(unittest.TestCase):
    def test_etime_secs(self):
        self.assertEqual([data.etime_secs(e) for e in ("00:05", "01:02:03", "2-00:00:01")], [5, 3723, 172801])

    def test_descendants_and_host(self):
        table = {1: dict(ppid=0, comm="launchd"), 10: dict(ppid=1, comm="idea"), 11: dict(ppid=10, comm="node"), 12: dict(ppid=11, comm="codex-acp"),
                 20: dict(ppid=1, comm="-zsh"), 21: dict(ppid=20, comm="codex")}
        self.assertEqual(sorted(data.descendants(10, table)), [11, 12])
        self.assertEqual(data.host_of(12, table), "IntelliJ")
        self.assertEqual(data.host_of(21, table), "terminal")
        self.assertIsNone(data.host_of(999, table))

    def test_prompt_text(self):
        self.assertEqual(data.prompt_text("hello   world\n"), "hello world")
        self.assertEqual(data.prompt_text("<environment_context>x</environment_context>"), "")
        self.assertEqual(data.prompt_text(None), "")

    def test_sum_tokens_splits_cached_input(self):
        t = data.sum_tokens(dict(input_tokens=100, cached_input_tokens=60, output_tokens=7, reasoning_output_tokens=3), 2)
        self.assertEqual(t, dict(input=40, output=7, cache_read=60, cache_write=0, reasoning=3, turns=2))
        self.assertEqual(data.sum_tokens(None)["turns"], 0)

    def test_entry_of(self):
        E = data.entry_of
        self.assertEqual((E("vscode", "Codex Desktop"), E("cli", "codex_cli_rs"), E("exec", "Codex Desktop"), E("vscode", "codex_vscode")),
                         ("desktop", "cli", "exec", "vscode"))
        self.assertEqual(E("mcp", "codex-acp"), "acp")
        self.assertEqual(E({"subagent": "x"}, None), None)

    def test_window_for(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(data, "CODEX", d):
            self.assertEqual(data.window_for("gpt-x", 1000, None, 258_400), (258_400, "reported"))
            self.assertEqual(data.window_for("gpt-x", 1000), (data.WINDOW_GUESS, "guess"))
            self.assertEqual(data.window_for("gpt-x", 400_000)[1], "evidence")
            with open(os.path.join(d, "models_cache.json"), "w") as f:
                json.dump(dict(models=[dict(slug="gpt-x", context_window=272_000)]), f)
            self.assertEqual(data.window_for("gpt-x", 1000), (272_000, "default"))

    def test_jwt_claims_never_raise(self):
        self.assertEqual(data.jwt_claims("garbage"), {})
        self.assertEqual(data.jwt_claims(""), {})

    def test_window_labels(self):
        self.assertEqual([data.window_label(m) for m in (300, 10080, 1440, 120, 45, None)],
                         ["5-hour session", "weekly", "1-day", "2-hour", "45-minute", "limit"])


class CodexProcTests(unittest.TestCase):
    def test_classification(self):
        P = lambda ppid, comm, args, path=None: dict(ppid=ppid, rss=1024, cpu=0.0, etime="01:00", comm=comm, path=path or comm, args=args)
        table = {1: dict(ppid=0, rss=0, cpu=0.0, etime="1-00:00:00", comm="launchd", path="launchd", args="launchd"),
                 10: P(1, "codex", "/Applications/ChatGPT.app/Contents/Resources/codex -c x=1 app-server --analytics", "/Applications/ChatGPT.app/Contents/Resources/codex"),
                 11: P(10, "codex-code-mode-host", "codex-code-mode-host"),
                 20: P(1, "-zsh", "-zsh"), 21: P(20, "codex", "codex --model x", "/opt/homebrew/bin/codex"),
                 22: P(20, "codex", "codex exec do it", "/opt/homebrew/bin/codex"),
                 30: P(1, "idea", "idea"), 31: P(30, "codex-acp", "codex-acp", "/x/codex-acp"),
                 40: P(21, "codex", "codex sandbox helper", "/opt/homebrew/bin/codex")}
        found = {p["pid"]: p for p in data.codex_procs(table)}
        self.assertEqual({k: (v["kind"], v["host"]) for k, v in found.items()},
                         {10: ("app-server", "Desktop"), 21: ("cli", "terminal"), 22: ("exec", "terminal"), 31: ("acp", "IntelliJ")})


class SubagentPhaseTests(unittest.TestCase):
    def test_phases(self):
        P = data.subagent_phase
        self.assertEqual(P(True, 5, True), "done")                       # a closed edge wins, even when it wrote a moment ago
        self.assertEqual(P(None, 5, True), "active")                     # written in the last 90 s
        self.assertEqual(P(False, 5, False), "active")
        self.assertEqual(P(None, 3600, True), "done")                    # no status, long quiet: assumed done
        self.assertEqual(P(False, 3600, True), "idle")                   # open edge, live chat, quiet: waiting or stalled
        self.assertEqual(P(False, 3600, False), "closed")                # its chat ended before it finished
        self.assertEqual(P(None, 300, True), "idle")
        self.assertEqual(P(None, 300, False), "closed")


class ScanTests(unittest.TestCase):
    def scan(self, **kw):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, f"rollout-2026-10-25T00-00-00-{SID}.jsonl")
            helpers.write_rollout(p, **kw)
            return data.scan(p)

    def test_scan_rollout(self):
        s = self.scan(ctx=50_000, turns=2)
        self.assertEqual((s["model"], s["entry"], s["cwd"], s["effort"], s["window"]), ("gpt-5.6-terra", "desktop", "/work/proj", "medium", 258_400))
        self.assertEqual(s["ctx"], 50_000)                       # last turn's input
        self.assertEqual(s["tokens"]["turns"], 2)
        self.assertEqual((s["tokens"]["output"], s["tokens"]["cache_read"], s["tokens"]["input"], s["tokens"]["reasoning"]), (10, 99_980, 20, 4))
        self.assertEqual((s["first_prompt"], s["last_prompt"]), ("please fix the thing", "now ship it"))
        self.assertFalse(s["open"])
        self.assertIsNone(s["waiting"])

    def test_open_turn_and_unanswered_tool_call_mean_waiting(self):
        s = self.scan(turns=2, pending_call=True)
        self.assertTrue(s["open"])
        self.assertEqual(s["waiting"], "tool call: shell")
        self.assertIsNotNone(s["waiting_since"])

    def test_nothing_is_waiting_when_approvals_are_off(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, f"rollout-x-{SID}.jsonl")
            helpers.write_rollout(p, turns=1, pending_call=True)
            text = open(p).read().replace("on-request", "never")
            open(p, "w").write(text)
            self.assertIsNone(data.scan(p)["waiting"])

    def test_desktop_user_message_items_are_read(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, f"rollout-x-{SID}.jsonl")
            item = helpers.jline(timestamp="2026-10-25T00:00:00Z", type="event_msg", payload=dict(
                type="item_completed", item=dict(type="UserMessage", content=[dict(type="text", text="# Files pasted\n\n## My request:\nreal ask")])))
            open(p, "w").write(item + "\n")
            self.assertEqual(data.scan(p)["last_prompt"], "real ask")

    def test_scan_tolerates_garbage_lines(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, f"rollout-x-{SID}.jsonl")
            with open(p, "w") as f:
                f.write('{"type":"event_msg","payload":{"type":"token_count" broken\nnot json at all\n"token_count"\n')
            self.assertEqual(data.scan(p)["tokens"]["turns"], 0)


class CollectTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = helpers.make_home(self.tmp.name, sessions=3)
        self.patches = [mock.patch.object(data, "CODEX", f"{self.home}/.codex"), mock.patch.object(data, "HOME", self.home),
                        mock.patch.object(data, "ps_table", return_value={})]
        for p in self.patches:
            p.start()
        data._meta_cache.clear()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def test_default_shows_only_live_chats(self):
        self.assertEqual(data.collect(), ([], 0))

    def test_archived_rows_newest_first(self):
        rows, hidden = data.collect(show_arc=True)
        self.assertEqual((len(rows), hidden), (3, 0))
        self.assertTrue(all(not r["active"] for r in rows))
        self.assertEqual([r["title"] for r in rows], ["Chat number 0", "Chat number 1", "Chat number 2"])
        self.assertEqual((rows[0]["source"], rows[0]["window"], rows[0]["cwd"], rows[0]["state"]), ("Desktop", 258_400, "/work/proj", "ended"))

    def test_limit_and_hidden_count(self):
        rows, hidden = data.collect(show_arc=True, limit=2)
        self.assertEqual((len(rows), hidden), (2, 1))
        self.assertEqual(data.collect(show_arc=True, limit=0)[1], 0)

    def test_days_window_and_project_filter(self):
        self.assertEqual(data.collect(show_arc=True, days=0)[0], [])
        self.assertEqual(len(data.collect(show_arc=True, project="proj")[0]), 3)
        self.assertEqual(data.collect(show_arc=True, project="nomatch")[0], [])

    def test_archived_sessions_folder_marks_the_chat_archived(self):
        src = os.path.join(self.home, ".codex", "sessions", "2026", "10", "25")
        arc = os.path.join(self.home, ".codex", "archived_sessions")
        os.makedirs(arc)
        name = sorted(os.listdir(src))[0]
        os.rename(os.path.join(src, name), os.path.join(arc, name))
        rows, _ = data.collect(show_arc=True)
        self.assertEqual(sorted(r["archived_by_ide"] for r in rows), [False, False, True])

    def table(self, **procs):
        base = {1: dict(ppid=0, rss=0, cpu=0.0, etime="10-00:00:00", comm="launchd", path="launchd", args="launchd"),
                100: dict(ppid=1, rss=1, cpu=0.0, etime="05:00:00", comm="-zsh", path="-zsh", args="-zsh")}
        base.update(procs)
        return base

    def touch_now(self, n=0):
        p = [os.path.join(dp, f) for dp, _, fs in os.walk(os.path.join(self.home, ".codex", "sessions")) for f in fs if f.endswith(".jsonl")]
        p.sort()
        os.utime(p[n], None)
        return p[n]

    def test_chat_in_a_running_app_server_is_live_and_its_memory_is_not_attributed(self):
        self.touch_now(0)
        t = self.table(**{"200": dict(ppid=1, rss=204800, cpu=1.5, etime="10:00", comm="codex", args="/Applications/ChatGPT.app/Contents/Resources/codex app-server",
                                      path="/Applications/ChatGPT.app/Contents/Resources/codex")})
        t[200] = t.pop("200")
        with mock.patch.object(data, "ps_table", return_value=t):
            rows, _ = data.collect()
            self.assertEqual([(r["session_id"], r["active"], r["state"], r["mem_mb"], r["host"], r["pid"]) for r in rows], [(SID, True, "idle", None, "Desktop", 200)])
        with mock.patch.object(data, "ps_table", return_value=self.table()):
            self.assertEqual(data.collect()[0], [])               # no server running: nothing is live

    def test_open_turn_keeps_a_chat_live_while_the_server_runs(self):
        p = self.touch_now(1)
        helpers.write_rollout(p, turns=2, open_turn=True)
        old = time.time() - 3000
        os.utime(p, (old, old))
        t = self.table()
        t[200] = dict(ppid=1, rss=1024, cpu=0.0, etime="10:00", comm="codex", args="/Applications/ChatGPT.app/Contents/Resources/codex app-server",
                      path="/Applications/ChatGPT.app/Contents/Resources/codex")
        with mock.patch.object(data, "ps_table", return_value=t):
            rows, _ = data.collect()
            self.assertEqual([(r["state"], r["active"]) for r in rows], [("busy", True)])

    def test_cli_process_is_matched_by_folder_and_start_time(self):
        p = self.touch_now(2)
        helpers.write_rollout(p, source="cli", originator="codex_cli_rs", cwd="/work/proj")
        t = self.table()
        t[300] = dict(ppid=100, rss=204800, cpu=2.0, etime="10:00", comm="codex", path="/opt/homebrew/bin/codex", args="codex")
        with mock.patch.object(data, "ps_table", return_value=t), mock.patch.object(data, "proc_cwd", return_value="/work/proj"):
            rows, _ = data.collect()
            self.assertEqual([(r["session_id"], r["state"], r["mem_mb"], r["host"], r["source"]) for r in rows],
                             [("01a00000-0000-7000-8000-000000000002", "idle", 200, "terminal", "terminal")])
        with mock.patch.object(data, "ps_table", return_value=t), mock.patch.object(data, "proc_cwd", return_value="/elsewhere"):
            rows, _ = data.collect()
            self.assertEqual([(r["title"], r["pid"]) for r in rows], [("(new chat)", 300)])

    def test_resume_argument_names_the_chat(self):
        t = self.table()
        t[300] = dict(ppid=100, rss=1024, cpu=0.0, etime="10:00", comm="codex", path="/opt/homebrew/bin/codex", args=f"codex resume {SID}")
        with mock.patch.object(data, "ps_table", return_value=t):
            rows, _ = data.collect()
            self.assertEqual([r["session_id"] for r in rows], [SID])


class SubagentAndDbTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = helpers.make_home(self.tmp.name, sessions=1)
        self.codex = f"{self.home}/.codex"
        self.patches = [mock.patch.object(data, "CODEX", self.codex), mock.patch.object(data, "ps_table", return_value={})]
        for p in self.patches:
            p.start()
        data._meta_cache.clear()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def child(self, cid="01a00000-0000-7000-8000-0000000000c1"):
        p = os.path.join(self.codex, "sessions", "2026", "10", "25", f"rollout-2026-10-25T00-00-09-{cid}.jsonl")
        helpers.write_rollout(p, source=dict(subagent=dict(thread_spawn=dict(parent_thread_id=SID, depth=1))))
        old = time.time() - 3600
        os.utime(p, (old, old))
        return cid

    def test_subagents_come_from_the_rollout_header_and_are_not_listed_as_chats(self):
        self.child()
        rows, _ = data.collect(show_arc=True)
        self.assertEqual(len(rows), 1)
        self.assertEqual([(a["id"][-2:], a["type"], a["phase"]) for a in rows[0]["subagents"]], [("c1", "agent", "done")])

    def test_sqlite_adds_titles_edges_and_archive_flag_read_only(self):
        cid = self.child()
        con = sqlite3.connect(os.path.join(self.codex, "state_5.sqlite"))
        con.execute("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, name TEXT, archived INTEGER, agent_nickname TEXT, agent_role TEXT, git_branch TEXT, extra_new_column TEXT)")
        con.execute("CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT PRIMARY KEY, status TEXT)")
        con.execute("INSERT INTO threads VALUES (?,?,?,?,?,?,?,?)", (SID, "db title", None, 1, None, None, "main", "x"))
        con.execute("INSERT INTO threads VALUES (?,?,?,?,?,?,?,?)", (cid, "sub work", None, 0, "Dirac", "worker", None, None))
        con.execute("INSERT INTO thread_spawn_edges VALUES (?,?,?)", (SID, cid, "open"))
        con.commit()
        con.close()
        os.remove(os.path.join(self.codex, "session_index.jsonl"))
        rows, _ = data.collect(show_arc=True)
        r = rows[0]
        self.assertEqual((r["title"], r["archived_by_ide"], r["branch"]), ("db title", True, "main"))
        a = r["subagents"][0]
        self.assertEqual((a["type"], a["desc"], a["phase"]), ("worker", "Dirac · sub work", "closed"))

    def test_broken_or_missing_database_falls_back_to_the_rollouts(self):
        with open(os.path.join(self.codex, "state_5.sqlite"), "w") as f:
            f.write("not a database")
        self.assertEqual(data.threads_db(), ({}, {}))
        self.assertEqual(data.collect(show_arc=True)[0][0]["title"], "Chat number 0")


class AccountTests(unittest.TestCase):
    def test_account_and_usage_from_the_codex_home(self):
        with tempfile.TemporaryDirectory() as d:
            helpers.make_home(d, sessions=1)
            with mock.patch.object(data, "CODEX", f"{d}/.codex"), mock.patch.object(data, "_cli_version", return_value="9.9"):
                acct, usage = data.account()
        self.assertEqual((acct["email"], acct["name"], acct["plan"], acct["tier"], acct["cli"], acct["default_model"]),
                         ("test@example.com", "Test User", "plus", "chatgpt", "9.9", "gpt-5.6-terra"))
        self.assertNotIn("SECRET", json.dumps(acct) + json.dumps(usage))
        limits = usage["utilization"]["limits"]
        self.assertEqual([(l["kind"], l["label"], l["percent"], l["is_active"]) for l in limits],
                         [("session", "5-hour session", 12, True), ("weekly_all", "weekly", 3, False)])
        self.assertIn("2026", limits[0]["resets_at"][:4] or "2026")
        self.assertLess(time.time() * 1000 - usage["fetchedAtMs"], 2 * 86400 * 1000 * 365)

    def test_a_window_that_already_reset_reads_zero(self):
        with tempfile.TemporaryDirectory() as d:
            helpers.make_home(d, sessions=1)
            p = os.path.join(d, ".codex", "sessions", "2026", "10", "25")
            f = os.path.join(p, sorted(os.listdir(p))[0])
            text = open(f).read().replace('"resets_at":%d' % 0, "")
            import re
            open(f, "w").write(re.sub(r'"resets_at":\d+', '"resets_at":1000', text))
            with mock.patch.object(data, "CODEX", f"{d}/.codex"), mock.patch.object(data, "_cli_version", return_value=None):
                limits = data.account()[1]["utilization"]["limits"]
        self.assertEqual([(l["percent"], l["reset_passed"]) for l in limits], [(0, True), (0, True)])

    def test_missing_codex_home_gives_empty(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(data, "CODEX", d):
            self.assertEqual(data.account(), ({}, {}))


if __name__ == "__main__":
    unittest.main()
