# Changelog

## v0.1.0 (2026-10-29)
- First release of the Codex edition, derived from the Claude Code status monitor (v0.8.0 of that project) and rewritten for Codex.
- Codex look: fuchsia accent (web UI tokens, plain page, favicon wording) and magenta panels in the terminal view, so it reads apart from the Claude edition (cyan).- Reads `~/.codex` only: rollout files in `sessions/` and `archived_sessions/`, `state_5.sqlite` threads (read-only), `session_index.jsonl`,
  `config.toml`; `auth.json` is never read for secrets.
- Chats from the Codex CLI, the ChatGPT / Codex desktop app, the VS Code / IDE extension and JetBrains (ACP); resume with `codex resume <id>`.
- Rate limits come from `token_count` events; there is no price-based cost, tokens only.
- Same TUI, view levels, OK/AMBER/RED badges, machine alerts and optional local web view as the Claude edition.
- `$cust-codex-status` skill for Codex; `install.sh` links the command into `~/.local/bin` and `~/.codex/bin` and the skill into `~/.codex/skills`,
  never overwriting a real file, and registers nothing in `~/.claude`.
