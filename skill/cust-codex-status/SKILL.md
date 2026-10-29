---
name: cust-codex-status
description: Live read-only diagnostic of Codex on macOS: plan, rate limits (5-hour and weekly) and every Codex chat across the CLI, the desktop app, VS Code and JetBrains (ACP) with model, tokens, context window, subagents and an OK/AMBER/RED health badge. Use when the user runs $cust-codex-status or asks which Codex sessions, chats, tokens, agents or limits are in use, or which chat needs attention. Default view is live chats only at level 75. Flags: --level 0-100, --compact, -D everything, -A archived only, -c account, -s subagents, -v verbose, -p project, -d days, -n rows, --json.
---

# $cust-codex-status: live Codex diagnostic

If the arguments are `help`, `-h` or `--help`: run `~/.codex/bin/cust-codex-status --help` and show it unchanged, nothing else.

If the first argument is `web`: run `~/.codex/bin/cust-codex-status --web --detach` plus any other arguments the user gave (for example
`--level 95` is ignored by the server but `--port N`, `-d N`, `-n N`, `-p text` apply). It starts the local web view in the background,
opens it in the browser and prints its URL. Show the URL as a link, say it is local and read-only and that it stops by itself about a
minute after the last browser tab closes, and stop there (no report, no flag table). If it says the add-on is turned off, show that
message and the command it suggests.

Otherwise run `~/.codex/bin/cust-codex-status --no-tui --no-color <the user's arguments>` (the same tool is on PATH as `cust-codex-status`) and show its output unchanged, inside a code block so the panels stay aligned. It is read-only, makes no API calls and uses no model tokens itself.

The default is level 75, "standard": health counts, rate limits and one card per live chat, with no prompt lines (that saves tokens). For more or less detail add `--level N`, for example `$cust-codex-status --level 40`.

Then, when no arguments were given, show this flag reference (skip it when the user already passed flags). Archived chats only appear with `--level 90` or higher, `-D` or `-A`; mention that if the user asks where they are:

| Flag | What it does |
|---|---|
| (none) | level 75 "standard": live health counts, rate limits, one card per live chat (OK/AMBER/RED badge with the reason, state, context bar, stats, folder, id/pid, resume and clean commands, tips); no prompt lines |
| `--level N` | how much to show, 0-100: 0-19 minimal (one line per chat), 20-44 compact, 45-69 lean cards, 70-89 standard (default 75), 90-100 full (prompts, subagents, archived list). Flags below add to it |
| `--compact` | one line per live chat plus rate limits |
| `-D`, `--detailed` | everything: live and archived chats, with subagents |
| `-A`, `--archived` | archived/ended chats only |
| `-n N` | max archived rows: default 20, a larger N is allowed, 0 = all (live chats are never limited) |
| `-d N` | how many days back archived chats go (default 7) |
| `-c`, `--account` | add full account details to the header (default: email and plan only) |
| `-p text` | only chats whose project path contains text |
| `-s` | list every subagent under each chat |
| `-v` | the latest 3 subagents per chat |
| `--no-prompts` | hide the first/latest prompt lines |
| `-w SECS` | auto-refresh: terminal only, not via this skill |
| `-i` | after the report, a prompt to pick a view (1-5 or 0-100), refresh or quit: terminal only, not via this skill |
| `-t`, `--tui` | full-screen interactive view: terminal only, not via this skill (see the last section) |
| `--no-tui` | static report instead of the full-screen view (this skill always passes it; in a terminal the full-screen view is the default) |
| `--no-arc-prompt` | hide the one-line prompt under each archived chat |
| `--json` | raw data |

Health badge, on every chat (live and archived): `OK` nothing to do; `AMBER` context at least 85%, waiting on a permission prompt, or idle for over an hour holding memory; `RED` context at least 95%. The reason is written next to the badge.

Each card shows: the badge, state (idle/busy, `*` = waiting on a permission prompt), model, a context bar (`~` after the percentage = the window is a guess), turns, output and cache tokens, memory, folder, session id and pid, a `resume` command (move the chat to the terminal) and a `clean` command (fresh chat in the same folder), plus tips. Show it unchanged. If the user wants to switch a chat to the terminal, point them to its `resume` line and warn to close it in the IDE or desktop app first (`codex fork <id>` makes a copy instead).

After the output add at most three short lines, only for what stands out:
- a live idle chat holding lots of memory or a near-full context window (suggest closing or `/compact` or a fresh chat)
- a chat still running subagents, or one waiting on a permission prompt (marked `*`)
- the rate-limit figures being stale (they come from the latest token_count event; `/status` in a Codex session is live)

Then ask once: "Refresh or exit?" If they say refresh, run it again. For a true live view tell them to run `cust-codex-status -w 5` in a terminal (auto-refresh) or `cust-codex-status -i` (a numbered prompt to change the view); those cost no tokens, a refresh through this skill does.

## Interactive view (real terminal only)

The full-screen TUI cannot run inside a Codex chat: the shell tool has no terminal, and anything drawn would come back as text and cost tokens. So when the user wants a live or interactive view, do not run it. Tell them to type `cust-codex-status` in a terminal: the full-screen view is the default there (zero tokens, no API calls); `--no-tui` gives static output. Keys (also listed at the bottom of the screen): `↑`/`↓` move the highlight, `Enter` selects a chat (rows expand), `Enter` again copies its resume command, `b`/`Esc` goes back (Esc twice quits), `i`/`f` copy id / fresh-chat command, `+`/`-` or `1`-`5` change the view level, `a` archived, `t` archived prompt line, `c` compact, `p` prompts, `v` subagents, `r` refresh, `q` quit, `m` shows every key in the footer. Inside a chat, keep using the static output above (add `--compact` or a lower `--level` if the user wants fewer tokens).

For a clickable, live view without a terminal, offer the web view: `$cust-codex-status web` (see the top of this file). In a terminal,
`cust-codex-status --web` opens the TUI and the web page together, and `w` inside the TUI starts it at any time.
