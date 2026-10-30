# Schema changes vs the Claude version (for the web view)

Report shape is unchanged: `--json` = `{account, usage, usage_fetched_at_ms, sessions}`; the bridge input is still `(rows, hidden, acct, usage)`.
`usage` is `{"utilization": {"limits": [...]}, "fetchedAtMs": ms}`, built from the newest `token_count.rate_limits` in any rollout.

## Session row (`data.row_for`)
- Same keys as before. Semantics that moved:
  - `transcript` = the rollout file path. `session_id` = Codex thread UUID (UUIDv7: the first 8 chars are NOT unique, see below).
  - `cost` is always `None` (no price table). Show tokens instead.
  - `tokens` = `{input, output, cache_read, cache_write, turns, reasoning}`. NEW: `reasoning`. `input` is the UNCACHED part (Codex counts cached tokens inside
    `input_tokens`); `output` includes reasoning tokens.
  - `ctx` = last turn's `input_tokens` (cached included); `window` = `model_context_window` reported by Codex (usually 258400).
  - `window_source`: `chat | config | reported | default | evidence | guess` (`reported` is new, `name` is gone). The "offer 1m" path in bridge never fires (needs
    `window == 200000 and source == "guess"`); `maybe_1m` is always false.
  - `source`/`entry`: entry is `cli | exec | desktop | vscode | acp | appserver` (was `cli | sdk-ts | claude-vscode | ...`). `source` is the label
    (terminal, exec, Desktop, VS Code, JetBrains). `host` is the app (Desktop, VS Code, IntelliJ..., terminal).
  - `mem_mb` is `None` for chats served by a shared app-server (desktop app, VS Code): one process serves all chats, memory cannot be split.
    `pid` is then the app-server pid. CLI / exec / ACP chats have their own process and a real `mem_mb`.
  - `state`: `busy` (turn open) / `idle` for live chats; `running?` / `ended` otherwise (as before).
  - `waiting` is a heuristic string: `"tool call: <name>"` (call unanswered >30 s while approvals are on) or `"<kind> approval"`; the health text says "waiting on approval".
  - `name` is always `None` (Codex has no per-process chat name); `title` comes from session_index / sqlite name / first prompt.
  - NEW key `branch` (git branch from state sqlite, else `None`).
  - Subagents come from `thread_spawn_edges` and the `source.subagent.thread_spawn` header of child rollouts. Same dict keys as before
    (`id, type, desc, model, tokens, ctx, mtime, state, phase`); `type` = agent role or `"agent"`, `desc` = nickname + title. Guardian (auto-review) threads are not listed.
  - Subagent rollouts and guardian threads never appear as chats.
  - `archived_by_ide` = thread archived in sqlite or rollout under `archived_sessions/`.

## Usage limits (`usage.utilization.limits[]`)
- Same keys (`kind, percent, resets_at (ISO), is_active, scope`), plus NEW `label` ("5-hour session", "weekly", "1-day", ...), `window_minutes`, `reset_passed`.
- `kind` is `session` (300 min), `weekly_all` (10080 min) or `window_<minutes>`. The web `_limits()` should prefer `l["label"]` over its kind->label map
  (the terminal renderer already does); otherwise the weekly label reads "weekly . all models" and other windows show the raw kind.
- `percent` is forced to 0 when `resets_at` has passed (the window rolled over); `reset_passed` is then true.
- No credit pools (`limit_dollars`) are produced. `usage_fetched_at_ms` = time of the token_count event, not of a fetch: STALE after `alerts.time.limits_stale_min` (15).
- If no rollout has rate limits, `usage` is `{}` and `account.plan` falls back to auth.json claims only.

## Account (`account` / `account_fields`)
- Same keys. `tier` and `billing` = auth.json `auth_mode` (chatgpt / apikey), `plan` = JWT claim `chatgpt_plan_type` (else rate_limits plan_type), `org` = default org title,
  `extra` = credits available, `since` = subscription start, `cli` = `codex --version`. Field labels: "sign-in" (was "rate-limit tier"), "credits" (was "extra usage"), "Codex CLI".
- Only non-secret JWT claims are read; no token is ever returned.

## Commands / text
- Resume: `cd <cwd> && codex resume <id>`; clean: `cd <cwd> && codex`; live-chat hint: `codex fork <id>`.
- Title text in the report: `CODEX STATUS`. Cost columns replaced by token totals.

## Config / env
- `CODEX_HOME` overrides `~/.codex` (`config.CODEX`, also `data.CODEX`; tests patch `data.CODEX` / `config.CODEX`; `data.CLAUDE`, `config.CLAUDE`, `data.ACP_ARCHIVE` are gone).
- Web switch env var: `CUST_CODEX_STATUS_WEB`. User config stays `~/.config/cust-codex-status/config.json`.
- Per-chat settings (`windows`, `chat_levels`) are keyed by the first 13 chars of the id (`config.chat_key`, was 8) because UUIDv7 ids share their first 8 chars within ~65 s.
  Lookups accept any key that is a prefix (>= 8 chars) of the chat id. The bridge's `--set-window <key>` offer command therefore prints 13 chars.
- New alert rule keys under `time`: `live_idle_min` (30), `waiting_secs` (30), `limits_stale_min` (15). Context levels: windows up to 300k use the "200k" levels (85/95).

## Footprint parts (`files.parts`)
- Parts are now `transcript` (the rollout), `shell_snapshots`, `visualizations`; `REGENERABLE = ("shell_snapshots", "visualizations")`.

## Tests
- `tests/helpers.py`: `row()` (Codex defaults), `write_rollout()`, `make_home(tmp, sessions)` builds `<tmp>/.codex`. `tests/test_web.py` still patches
  `cust_codex_status.data.CLAUDE`; change it to `data.CODEX` (value `os.path.join(tmp, ".codex")`).
