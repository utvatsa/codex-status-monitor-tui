# Changelog

## v0.2.0 (2026-10-30)
- New Codex look in the terminal view and the plain-JS page, apart from the Claude edition: ink, orchid and coral palette (no cyan), heavy
  `┏━┓` frames with `▍CODEX ▸ title` headings, pill health badges and thin `━┄` gauges. 256 colours when the terminal has them, the 8 ANSI
  colours otherwise; green, amber and red now mean health only. The curses view uses the same palette (orchid cursor, coral selection).
- Header replaced by six metric tiles: THREADS, CACHE HIT, REASONING, CONTEXT HEADROOM, TOKENS / TURN and RATE LIMIT, plus an approval /
  model / surface line. They adapt to the width (six boxes, 3 x 2, or one-line chips) and to the view level.
- Narrow terminals (down to 60 columns) now read properly: compact and archived rows drop columns, long lines wrap between parts.
- `--json` has a top-level `metrics` key; `metrics.py` (`codex_metrics`) is shared with the web page.
- Plain-JS page: the same six tiles from `totals.metrics`, an ink and orchid look, and the React pages' theme ids (auto, dark, light,
  sunset, phosphor, ink; old paper, nord and dracula values map over).

## v0.1.0 (2026-10-29)
- First release of the Codex edition, derived from the Claude Code status monitor (v0.8.0 of that project) and rewritten for Codex.
- Codex look: fuchsia accent (web UI tokens, plain page, favicon wording) and magenta panels in the terminal view, so it reads apart from the Claude edition (cyan).- Reads `~/.codex` only: rollout files in `sessions/` and `archived_sessions/`, `state_5.sqlite` threads (read-only), `session_index.jsonl`,
  `config.toml`; `auth.json` is never read for secrets.
- Chats from the Codex CLI, the ChatGPT / Codex desktop app, the VS Code / IDE extension and JetBrains (ACP); resume with `codex resume <id>`.
- Rate limits come from `token_count` events; there is no price-based cost, tokens only.
- Same TUI, view levels, OK/AMBER/RED badges, machine alerts and optional local web view as the Claude edition.
- `$cust-codex-status` skill for Codex; `install.sh` links the command into `~/.local/bin` and `~/.codex/bin` and the skill into `~/.codex/skills`,
  never overwriting a real file, and registers nothing in `~/.claude`.
