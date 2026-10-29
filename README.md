# Codex Status Monitor TUI

A read-only terminal dashboard for [OpenAI Codex](https://developers.openai.com/codex) on macOS. One command shows your plan, the
rate limits Codex last recorded, and every Codex chat (thread) from the Codex CLI, the ChatGPT / Codex desktop app, the VS Code (IDE)
extension and JetBrains (through ACP), with model, tokens, context-window fill and subagents. Each chat gets a clear
**OK / AMBER / RED** health badge and the reason, so you can see at a glance which chat needs you.

It reads only local files under `~/.codex` and `ps`. It makes **no API calls**, uses **no model tokens**, never reads secrets (it does
not open `auth.json` for tokens; at most it reads the plan name from the ID-token claims, never the token itself) and never changes,
kills or deletes anything (the only thing it writes is your clipboard, when you ask it to copy a resume command).

This is the Codex sibling of `claude-status-monitor-tui` (same layout, keys, health badges and web view). The differences are listed
under [What differs from the Claude version](#what-differs-from-the-claude-version).

## Features
- **Health badge per chat:** `OK` / `AMBER` / `RED` plus the reason. The levels depend on the chat's context window (see
  [Alerts](#alerts-and-context-windows)); high memory and an idle chat holding memory are AMBER too. Header shows live counts.
- **Rate limits:** the primary (5-hour) and secondary (weekly) windows with bars, taken from the latest `token_count` event in the
  newest rollout files, flagged STALE when old.
- **View dial:** `--level 0-100` from one line per chat up to everything (default 75).
- **Full-screen TUI** (the default on a terminal, stdlib `curses`): a menu of chats. Move with the arrow keys, `Enter` selects (collapsed rows
  expand with details), `Enter` again copies the `codex resume <id>` command; `b`/`Esc` goes back. Key helpers sit at the bottom.
- **Web view (optional add-on):** `--web`, or `w` in the TUI, serves the same report as a local web page and opens it. It shows the data
  the TUI already read (no second reader), binds to `127.0.0.1` only and stops after a minute with no browser open. See [Web view](#web-view).
- **Also:** `--compact`, `-D` / `-A` archived chats, `-c` account details, `-p` project filter, `-s` subagents, `--json`,
  `-w SECS` auto-refresh, `-i` numbered view prompt, and a `$cust-codex-status` skill for use inside Codex.

## Requirements
macOS (uses `ps` and `pbcopy`), Python 3.9+ with the standard library only, and Codex (it reads `~/.codex`; `CODEX_HOME` is honoured when set).

## Install
```sh
git clone https://github.com/utvatsa/codex-status-monitor-tui.git
cd codex-status-monitor-tui
./install.sh --dry-run   # shows exactly what it would do
./install.sh             # symlinks the command onto your PATH and the skill into Codex
```
`install.sh` only creates three symlinks (nothing is copied, no packages installed, no dotfiles edited) and never overwrites a real file
or folder. Nothing is registered in `~/.claude`.

| Link | Why |
|---|---|
| `~/.local/bin/cust-codex-status` | the `cust-codex-status` command (add `~/.local/bin` to your `PATH` if it is not there) |
| `~/.codex/bin/cust-codex-status` | the path the `$cust-codex-status` skill calls |
| `~/.codex/skills/cust-codex-status` | the `$cust-codex-status` skill for Codex |

**If a real file or folder is in the way** (for example an older hand-made `cust-codex-status` skill folder or wrapper script), the installer
prints `SKIPPED` for it and exits with status 1 after linking the rest. Move it aside, then run `./install.sh` again:
```sh
mv ~/.codex/skills/cust-codex-status ~/.codex/skills/cust-codex-status.old   # keep the old copy outside the skills folder if you prefer
mv ~/.local/bin/cust-codex-status ~/.local/bin/cust-codex-status.old
```
(Codex scans skill folders by `name`, so leave no second copy named `cust-codex-status` inside a skills folder: move the old one out of
`~/.codex/skills` entirely, e.g. into `~/.codex/skills-disabled/`.)

**Skill location note:** Codex's current docs list `$HOME/.agents/skills` (user) and `<repo>/.agents/skills` as the skill folders;
this Mac already keeps its skills in `~/.codex/skills`, so the installer links there. If your Codex does not pick the skill up, link it
into `~/.agents/skills/cust-codex-status` as well (`ln -s <repo>/skill/cust-codex-status ~/.agents/skills/cust-codex-status`).

**Uninstall:** `./uninstall.sh` removes those links, and only if they point into this repo. The repo itself is never touched.

**Without symlinks:** run `bin/cust-codex-status` directly, or `pip install .` in a virtualenv (the skill still needs the symlinks above).

## Use
```sh
cust-codex-status                 # full-screen interactive view (the default on a terminal)
cust-codex-status --no-tui        # one static report: health, limits, one card per live chat
cust-codex-status --level 40      # less detail (0 = minimal)
cust-codex-status --level 95      # everything: prompts, subagents, archived chats
cust-codex-status -i              # report, then a prompt: 1-5 or 0-100 changes the view, r refresh, q quit
cust-codex-status -t              # force the full-screen view (errors when there is no terminal)
cust-codex-status --json | jq .   # raw data
```
Inside Codex (CLI or IDE extension) type `$cust-codex-status`, or pick it from `/skills`.

### View levels
| Level | View |
|---|---|
| 0-19 | minimal: one line per live chat plus health counts |
| 20-44 | compact: adds rate limits and attention warnings |
| 45-69 | lean cards: badge, state, stats, resume command |
| 70-89 | standard cards (default 75): adds folder, ids, tips, no prompt lines |
| 90-100 | full: adds first/latest prompts, subagents and the archived list |

Explicit flags (`--compact`, `-D`, `-v`, `--no-prompts`) add to the chosen level.

### TUI (the default on a terminal; `--no-tui` for static output)
Two modes, shown in the bar above the key helpers. **NAVIGATE** (cyan highlight): look around. **SELECTED** (green): you picked a chat.

| Key | NAVIGATE | SELECTED |
|---|---|---|
| `Up` `Down` / `Tab` | move the highlight | select another chat |
| `Enter` or click | select the highlighted chat (collapsed rows expand) | copy the resume command (so does `y`) |
| `b` / `Esc` | `Esc` once warns, twice quits | go back to NAVIGATE |
| `i` / `f` | | copy the session id / the fresh-chat command |
| `Shift+Up/Down`, `PgUp` `PgDn`, `Space`, `j` `k`, `g` `G`, mouse wheel | scroll | scroll |
| `+` `-`, `1`-`5` | change the view level | same |
| `a` `c` `p` `v` `t` | toggle archived, compact, prompts, subagents, the archived one-line prompt | same |
| `m` `[` `]` `r` `Ctrl-L` `q` | show all keys in the footer, refresh interval, refresh now, repaint, quit | same |

`Cmd+/-` cannot be used as view keys (the terminal keeps Cmd for font zoom); `+` / `-` are the view keys, and the TUI also accepts
`Esc +` / `Esc -` if you map Cmd to send those in your terminal.

## Web view
The same report in a browser, served from your own machine while you need it. Optional: turn it off with `cust-codex-status --set-web off`
(or `./install.sh --no-web`) and back on with `--set-web on` (or `./install.sh --web`); the code is only imported when used.

```sh
cust-codex-status --web                 # TUI + web page, opened in your browser; the URL is on the TUI's top line
cust-codex-status --web --no-tui        # web page only, in the foreground (Ctrl-C stops it)
cust-codex-status --web --detach        # web page only, in the background; prints the URL and returns
cust-codex-status --web --no-open       # don't open a browser, just print / show the URL
cust-codex-status --web --port 9000     # first port to try (default 8765, then the next 20, then any free one)
cust-codex-status --web --web-idle 300  # stop after 5 minutes with no browser open (default 60s; 0 = never)
```
In the TUI the top line reads **`WEB off · w open in browser`**; `w` starts the server and opens the page, and the line then shows the URL,
how many browsers are open, `w` (open again) and `W` (stop the server). Both are clickable.

**On the page:** a sticky top bar with the address, a live/reconnecting dot, *updated Ns ago*, Refresh, the theme menu and the shortcuts
button; the account line; four KPI tiles (live chats with health counts, memory held, live cost, busiest usage limit); a needs-attention card (a summary you can page through and expand) beside the usage limits; a sticky toolbar with the view switch (minimal … full), toggles (archived, compact rows, prompts, subagents) and a
filter; live chats as cards or rows; archived chats as rows. On a wide screen a **details panel** on the right follows the highlighted
chat (folder, ids, prompts, resume / clean commands, tips, subagents); on a narrow one the details open under the selected chat.
**Copy** buttons copy the resume command, session id or fresh-chat command; the chevron expands a row without selecting it.
A bottom bar shows the mode (NAVIGATE / SELECTED) and the keys, or the selected chat's copy actions, like the TUI's footer.

| Key | Does |
|---|---|
| `↑` `↓` / `j` `k`, `g` `G` | move the highlight, first / last chat |
| `Enter` | select the highlighted chat (rows expand); again: copy its resume command |
| `y` / `i` / `f` | copy the resume command / session id / fresh-chat command |
| `Esc` / `b` | back to NAVIGATE (or clear the filter) |
| `+` `-`, `1`–`5` | view level |
| `a` `c` `p` `v` `s` `t` | archived, compact rows, prompts, subagents (latest 3), all subagents, archived prompt line |
| `e` / `u` | expand or collapse every row / account details |
| `r` `/` `d` `?` | refresh now, filter, next theme, all keys |

**Themes:** Auto (follows the system), Light, Dark, and three extra palettes: Light · Paper (warm), Dark · Nord (cool blue-grey) and
Dark · Dracula (purple). Pick one in the top bar or press `d`; the choice, the view level and the archived prompt line are remembered
per browser. `?level=0-100` and `?theme=<name>` in the address set them too (handy for a bookmark).

**How data gets there (the bridge):** the TUI reads the disk exactly as before; after each read it hands the result to a small in-process
`Hub`, which turns it into JSON (health levels, reasons, tips and number formats come from the same Python functions as the terminal
output) and pushes it to every open page over Server-Sent Events. The page's Refresh button and its *archived* toggle only *ask* the TUI
to read again. With `--web --no-tui` the same loop runs without the TUI and reads only while a page is open.

**Safety:** binds `127.0.0.1` only; refuses requests whose `Host` is not `127.0.0.1`/`localhost` on its port (DNS rebinding) and POSTs
from other origins; sends no CORS headers, so other web pages cannot read it; strict Content-Security-Policy; serves a fixed list of five
files and nothing else from disk. It only reads Codex's data. The page's writes are your clipboard and one more thing: the context
window and alert levels of a single chat, saved in the tool's own settings file (`POST /api/config`, same checks as above, whitelisted
to that one setting; nothing of Codex's is ever written, and the tool's own settings are never changed from the page).

**Stack:** Python's `http.server` (stdlib) serving a [React](https://react.dev) 19 + TypeScript page built with [Vite](https://vite.dev)
(about 80 KB gzipped). The source is in [`web-ui/`](web-ui/) and the build is committed under `src/cust_codex_status/web/static/`, so
installing or running the tool needs no Node and no network; only changing the page does. No CDN: it works offline.
**Learning React?** [`web-ui/TUTORIAL.md`](web-ui/TUTORIAL.md) walks through how this page was built, step by step.

### Three versions of the page
Same data, same keys, same six themes, three ways to build the page, so you can compare them:

| Address | Version | Built with |
|---|---|---|
| `/plain` | Plain JS | Preact + htm, no build step |
| `/` | React, first design | React 19 + TypeScript, built with Vite |
| `/react2` | React, second design ("Aurora") | React 19 + TypeScript: glass, motion, live charts, command palette on Cmd/Ctrl+K |

A strip at the top of every version switches between them in that order, plain, React, Aurora (**Shift+V** cycles) and shows how many files and KB of JS and CSS the current one loaded.
The theme and `?level=` carry over. Sources: `web-ui/src/` (first React), `web-ui/src/v2/` (Aurora) and `web-ui/public/plain/` (plain JS); `npm run build` ships all three,
and `PAGES` in `web/server.py` maps addresses to built pages.

### Working on the page
```sh
cd web-ui
npm ci                     # once (Node 24 LTS, or 22.22+; see .nvmrc); installs the exact versions in package-lock.json
cust-codex-status --web --no-open --web-idle 0 &   # the data source, on 127.0.0.1:8765
npm run dev                # http://localhost:5173/static/ with instant reload; /api is proxied to the server above
npm test                   # 24 component and unit tests (Vitest + Testing Library)
npm run build              # type-check, then build into src/cust_codex_status/web/static/ (commit the result)
```

## How it works
Everything comes from local files under `~/.codex` and `ps`:
- `sessions/YYYY/MM/DD/rollout-*.jsonl` (and `archived_sessions/`): the per-thread event log. `session_meta` gives the id, cwd, originator
  (`Codex Desktop`, `codex_cli_rs`, VS Code and so on) and CLI version; `turn_context` gives the model; `token_count` events give input,
  cached, output and reasoning tokens, the model context window, and `rate_limits` (primary and secondary used-percent and reset time).
- `state_5.sqlite` (table `threads`): thread titles, cwd, timestamps and archive state; opened read-only. The number in the file name is
  Codex's schema version and may change, so the newest `state_*.sqlite` is used.
- `session_index.jsonl`: id to thread name, the fallback title.
- `config.toml`: the default model and settings (read only).
- `ps`: live Codex processes (CLI, desktop app helper, IDE and ACP agents), pid, memory and the host app.
- `auth.json` is **never** read for secrets.
See [docs/DESIGN.md](docs/DESIGN.md).

## What differs from the Claude version
| Claude Code version | Codex version |
|---|---|
| `~/.claude/sessions/*.json`, `projects/**/*.jsonl` | `~/.codex/sessions/**/rollout-*.jsonl`, `state_5.sqlite`, `session_index.jsonl` |
| Cost in dollars from a price table | **No price-based cost.** Codex is billed through the ChatGPT plan or API credits and has no price table here; the tool shows tokens (input, cached, output, reasoning) only |
| 5-hour / weekly limits from `~/.claude.json` cache | Rate limits from the latest `rate_limits` of `token_count` events, so they are only as fresh as the newest turn; `/status` in Codex shows live numbers |
| Context window guessed from the model id | Codex records `model_context_window` in `token_count` events, so the window is usually known, not guessed |
| Live chats from `~/.claude/sessions/<pid>.json` | Live chats from `ps` matched to recently written rollout files (no per-pid session file) |
| Resume: `claude --resume <id>` | Resume: `codex resume <id>` (run in the chat's folder, or pass `-C`; `codex resume --last` for the newest) |
| Skill: `/cust-claude-status` in `~/.claude/skills` | Skill: `$cust-codex-status` (or `/skills`) in `~/.codex/skills` |
| Hosts: terminal, VS Code, JetBrains (ACP) | Hosts: Codex CLI, ChatGPT / Codex desktop app, VS Code / IDE extension, JetBrains (ACP) |

## Alerts and context windows
The window is taken from the rollout's own `model_context_window` when present; otherwise, in this order: **set by you for this chat**,
set by you for a model (config file), **proof** (a turn above the assumed size), the built-in table, and only then a **guess**. The page
shows which one applied.

| Alert | AMBER | RED |
|---|---|---|
| Context, 200k window | >=85% | >=95% |
| Context, 1M window | >=60% | >=90% |
| Context, any other size | suggested from the size, or your own levels | |
| One chat's memory (process and children) | >=1.5 GB | >=3 GB |
| Idle >1h holding memory | >=150 MB | |
| Busy with no output for 20 min | maybe stuck | |
| Rate limit | >=80% | >=85% |
| **Machine:** live chats together vs RAM | >=25% | >=40% |
| **Machine:** free disk on the home volume | <10 GB | <3 GB |

Every number can be overridden under `alerts` in `~/.config/cust-codex-status/config.json`; `cust-codex-status --show-alerts` prints the
rules in effect, `--set-window <chat id> 600k [--levels 70 90]` and `--clear-window <chat id>` fix one chat.

## Known limits
- Rate limits are as old as the newest `token_count` event; Codex's own `/status` is live.
- "Live" means a running Codex process with a recently written rollout; Codex keeps no per-pid file, so a chat that is open but quiet for a long time can look archived.
- Codex's on-disk formats (`state_5.sqlite`, rollout event shapes) are not a public API and change between versions; the tool reads defensively and shows `?` for what it cannot find.
- JetBrains (ACP) and VS Code host detection depend on the process tree and the rollout `originator`/`source` fields.
- The web page is checked in Chrome; Safari and Firefox are not tested yet.

## Roadmap
- A standalone installable TUI (for example `pipx`), with the same read-only guarantee.
- Optional `--close N` for live idle chats and a dry-run-first `--prune`: deliberately **not** built, see DESIGN.

## Development
```sh
tests/run.sh           # unit tests on generated fake data: never reads your real ~/.codex
tests/run.sh --real    # also a read-only smoke test against your real Codex data
```
Layout:

| Path | What it is |
|---|---|
| `bin/cust-codex-status` | thin launcher (works through symlinks) |
| `src/cust_codex_status/` | the package: `config` (paths), `util` (formatting), `data` (reads disk and `ps`), `health` (OK/AMBER/RED rules), `views` (the `--level` dial), `render` (panels and cards), `report` (glue), `tui` (curses), `cli` (flags), `web/` (optional web view) |
| `web-ui/` | the web page's source: React + TypeScript + Vite |
| `skill/cust-codex-status/SKILL.md` | the Codex skill |
| `tests/` | `unittest` suite, fixtures are generated in `tests/helpers.py` |
| `docs/DESIGN.md` | principles, decisions, gotchas |
| `install.sh`, `uninstall.sh`, `pyproject.toml` | install and packaging |

## License
MIT, see [LICENSE](LICENSE).
