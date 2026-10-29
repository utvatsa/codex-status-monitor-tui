"""Shared test helpers: put src/ on the path, build fake rows and a fake ~/.codex, with no real chat data."""
import base64
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))
TOOL = os.path.join(ROOT, "bin", "cust-codex-status")


def row(**kw):
    """A chat row exactly as data.row_for builds it (all keys the renderer reads), overridable per test."""
    now = time.time()
    r = dict(host="terminal", session_id="11111111-2222-3333-4444-555555555555", active=True, archived_by_ide=False, name="demo-chat",
             title="Demo chat", source="terminal", entry="cli", state="idle", waiting=None, pid=123, mem_mb=100, cpu=0.0, up="01:00",
             version="1.0", model="gpt-5.6-terra", effort=None, models={}, ctx=20_000, window=200_000,
             tokens=dict(input=10, output=20, cache_read=30, cache_write=40, reasoning=5, turns=3), cost=None, cwd="~/proj", last_active=now,
             first_prompt="first prompt text", latest_prompt="latest prompt text", last_run=now, subagents=[])
    r.update(kw)
    return r


def jline(**d):
    return json.dumps(d, separators=(",", ":"))


def write_rollout(path, ctx=50_000, turns=2, cwd="/work/proj", source="vscode", originator="Codex Desktop", prompt="please fix the thing",
                  model="gpt-5.6-terra", window=258_400, used=(12.0, 3.0), last_prompt="now ship it", open_turn=False, pending_call=False,
                  start="2026-10-25T00:00:00.000Z"):
    """A small but realistic Codex rollout: session_meta, `turns` turns (task_started, user_message, turn_context, token_count with rate
    limits, task_complete), optionally an open last turn or an unanswered tool call."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sid = os.path.basename(path)[:-6][-36:]
    ev = lambda ts, t, **p: jline(timestamp=ts, type="event_msg", payload=dict(type=t, **p))
    lines = [jline(timestamp=start, type="session_meta", payload=dict(id=sid, cwd=cwd, originator=originator, cli_version="0.99.0", source=source,
                                                                 timestamp=start, base_instructions=dict(text="x" * 50)))]
    for i in range(turns):
        t = f"2026-10-25T00:0{i + 1}:00.000Z"
        usage = dict(input_tokens=ctx, cached_input_tokens=ctx - 10, cache_write_input_tokens=0, output_tokens=5, reasoning_output_tokens=2, total_tokens=ctx + 5)
        total = {k: v * (i + 1) for k, v in usage.items()}
        lines += [ev(t, "task_started", turn_id=f"t{i}", model_context_window=window),
                  ev(t, "user_message", message=prompt if i == 0 else last_prompt),
                  jline(timestamp=t, type="turn_context", payload=dict(turn_id=f"t{i}", cwd=cwd, model=model, effort="medium", approval_policy="on-request")),
                  ev(t, "token_count", info=dict(total_token_usage=total, last_token_usage=usage, model_context_window=window),
                     rate_limits=dict(limit_id="codex", primary=dict(used_percent=used[0], window_minutes=300, resets_at=int(time.time()) + 3600),
                                      secondary=dict(used_percent=used[1], window_minutes=10080, resets_at=int(time.time()) + 86400), plan_type="plus"))]
        if i < turns - 1 or not (open_turn or pending_call):
            lines.append(ev(t, "task_complete", turn_id=f"t{i}"))
    if pending_call:
        lines.append(jline(timestamp="2026-10-25T00:30:00.000Z", type="response_item",
                           payload=dict(type="function_call", name="shell", call_id="call_1", arguments="{}")))
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


def make_home(tmp, sessions=1, age_days=0):
    """<tmp>/.codex with `sessions` ended-looking rollouts, an index with names and an auth.json (no real secrets). Returns the home path."""
    codex = os.path.join(tmp, ".codex")
    index = []
    for n in range(sessions):
        sid = f"01a00000-0000-7000-8000-{n:012d}"
        p = os.path.join(codex, "sessions", "2026", "10", "25", f"rollout-2026-10-25T00-00-0{n}-{sid}.jsonl")
        write_rollout(p)
        t = time.time() - 3600 - age_days * 86400 - n * 60     # an hour old at least: ended, not "running?"
        os.utime(p, (t, t))
        index.append(jline(id=sid, thread_name=f"Chat number {n}", updated_at="2026-10-25T00:00:00Z"))
    os.makedirs(codex, exist_ok=True)
    with open(os.path.join(codex, "session_index.jsonl"), "w") as f:
        f.write("\n".join(index) + "\n")
    claims = dict(email="test@example.com", name="Test User", **{"https://api.openai.com/auth": dict(chatgpt_plan_type="plus")})
    b64 = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    with open(os.path.join(codex, "auth.json"), "w") as f:
        json.dump(dict(auth_mode="chatgpt", tokens=dict(id_token=f"{b64({'alg': 'none'})}.{b64(claims)}.sig", access_token="SECRET-ACCESS", refresh_token="SECRET-REFRESH")), f)
    with open(os.path.join(codex, "config.toml"), "w") as f:
        f.write('model = "gpt-5.6-terra"\nmodel_reasoning_effort = "medium"\n\n[plugins]\nmodel = "ignored"\n')
    return tmp
