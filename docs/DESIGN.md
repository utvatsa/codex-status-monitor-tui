# Design notes

## Principles
- **Read-only.** No API calls, no model tokens, no writes except the clipboard (`pbcopy`) when asked.
- **Standard library only.** Nothing to install beyond Python 3.9+. (The optional web page is a prebuilt React bundle committed in the
  package; Node is needed only to change it, in `web-ui/`.)
- **Colour means one thing.** Card frame = group (live cyan, archived grey). Health = a separate OK/AMBER/RED badge with the reason.
  (An earlier version coloured frames by state, so an 89%-context chat looked green.)

## Structure
```
cli ──> report ──> data      (reads ~/.codex, ps)        no output, no colours
 │         └─────> render ──> health, views, util         text only, no I/O
 └─────> tui ────> report, + pure helpers (parse, item spans, scroll, footer layout, Esc logic, clipboard)
```
```
tui / --web loop ──> report.fetch ──> web.bridge.Hub.publish ──> snapshot JSON ──> web.server ──SSE──> page (static/app.js)
                          ▲                                                           │ POST /api/refresh
                          └──────────── hub.take_refresh() (owner re-reads) ◀─────────┘
```
- `data` returns plain dicts; `render` turns rows into text; neither knows about the other. `report` is the only glue.
- `config.DEFAULT_RULES` holds every number an alert uses (the user can override any of them under `alerts` in the config file), and `health.py`
  holds the rules that use them, so badges, tips, warnings and the web page cannot disagree. `footprint.py` measures what a chat leaves on disk and
  suggests (never runs) cleanup.
- `tui.py` keeps everything testable without a terminal as module-level functions; only the curses loop needs a tty.
- Everything is read from under `$HOME`, so tests (and a curious user) can point the tool at a fake `~/.codex`.
- Colour is one module-level switch (`util.C.on`); it is the only global state.

## Decisions
- **No close/kill or delete from the tool.** Archived chats have no process or memory to free; deleting transcripts is irreversible and
  breaks `--resume` and handoff notes; killing an IDE (ACP) process or a busy chat can lose work. If ever added: a separate `--close N`
  for live idle chats only (confirm, show pid and MB freed) and a dry-run-first `--prune` listing files and sizes.
- **No click-to-change views outside the TUI.** Mouse input needs full-screen mode, so plain output offers `-i` (a numbered prompt) instead.
- **`--level 0-100` is bucketed into five views** (minimal, compact, lean, standard, full) because only about five distinct layouts exist.
- **Cmd+arrow is not used** for paging: terminals intercept it. Shift+arrow works (iTerm2 verified).
- **View keys are `+` / `-`.** ⌘+/⌘- cannot be read (the terminal keeps Cmd for font zoom) and Ctrl+= / Ctrl++ send nothing distinct, so the footer lists only
  `+` / `-`. The TUI also accepts `Esc +` / `Esc -`, which a terminal can be told to send for Cmd+/- (optional, README has the iTerm2 steps).
- **The TUI is a two-mode menu** (NAVIGATE / SELECTED). Selection is held by session id, not line number, so refreshes and expansions cannot move it.
  `render_ui` fills an `items` list (one dict per selectable chat); the TUI pairs it with the item spans it finds in the text. Collapsed rows
  expand through `args.expand`. View changes re-render cached data; only the timer and `r` re-read the disk.
- **The footer is short by default** (everyday keys + `m MORE keys`); `m` expands to every key and it closes after the next key, so the screen stays mostly for chats.
- **Full-screen is the default** on a terminal; anything without a tty (pipes, the skill, `--json`) silently stays static.
- **The TUI cannot run inside a Codex chat** (no tty), so the skill runs static output (`--no-tui`) and tells the user to run `cust-codex-status`, where the full-screen view is the default.

- **The page's one write is a single chat's window and levels.** `POST /api/config` takes `{"chat": {"sid", "window", "amber"?, "red"?}}` (or
  `clear`), validated and written atomically to the tool's own config (`windows[sid8]`, `chat_levels[sid8]`) behind the same host and origin
  checks. A chat's setting is stamped (`chat_set`) and pruned on the next write once it is 90 days old and the chat has been quiet that long. Model-wide settings and default levels are CLI-only (`--set-window <model>`, `--set-context`), because a mistake there changes every chat.
- **Machine alerts get their own band and may be snoozed, but never vanish.** Snooze minimises to a chip (browser-only state), stays until the
  condition clears, and an alert that escalated to RED stays open even if it eases back, so a snooze cannot hide a worse state.
- **Cleanup is advice, not action.** `footprint.advice()` returns text and an `rm -rf` of only the regenerable parts (never the transcript, so
  resume keeps working); the tool never executes it.

- **The web view is a second front-end on the same data, not a second backend.** The data owner (the TUI, or the `--web` loop when there
  is no TUI) fetches as always and publishes to `web.bridge.Hub`; the server only serves the latest snapshot. Health, tips and number
  formats are computed in Python (`snapshot()` calls `health()`, `tips()`, `fmt()`), so the page cannot disagree with the terminal.
  The page's Refresh and archived toggle only *ask* the owner to read (`take_refresh`); once a page asks for archived chats the owner
  keeps reading them for that server's life (`want_arc`), which the renderer ignores unless the view shows them.
- **Shared data, separate views.** The browser has its own level, toggles, selection and filter; nothing it does moves the TUI's cursor.
- **Opt-in and self-stopping.** The server runs only with `--web` or after `w`; it stops after `WEB_IDLE_SECS` (60) with no page connected
  (any request resets the clock; an open event stream counts as connected), on `W`, or when the TUI quits.
- **Optional add-on.** `web/` is imported lazily; `--set-web off|on` (or `./install.sh --no-web|--web`) saves `{"web": false|true}` in
  `~/.config/cust-codex-status/config.json` (`CUST_CODEX_STATUS_WEB=0/1` overrides). That file is the tool's only write besides the
  clipboard, and only when asked. When off, the TUI hides its web line and `--web` explains how to turn it on.
- **Why React + TypeScript + Vite, with the build committed.** The industry-standard stack (and a good one to learn on: see
  `web-ui/TUTORIAL.md`), typed against the bridge's JSON. The build goes straight into `web/static/` and is committed, so users never need
  Node or the network; ~80 KB gzipped, cached for good by the browser (content-hashed file names, `immutable`). The server is stdlib
  `http.server`: one thread per open tab, a few MB of RAM. (v0.4.0 used a 13 KB Preact+htm page with no build step; it lives on in git
  history and in the `feature/web-view` branch.)
- **Page state is one reducer.** `web-ui/src/state/ui.ts` holds level, toggles, cursor/selection, filter and expansions; keys, clicks and the
  toolbar dispatch the same actions, so they cannot drift, and the rules are unit-tested without rendering.
- **Static files: allow-list built at start-up.** `server.static_files()` walks `web/static/` once (known extensions only); a request is
  matched against those keys and never joined onto a disk path.
- **Local-only safety.** 127.0.0.1 bind, Host allow-list (DNS rebinding), same-origin POST, no CORS, strict CSP (no inline script or
  style), a fixed file allow-list. The page writes nothing but the clipboard.

## Health rules (`health()` and `system_alerts()`)
A chat's context window is **resolved, not assumed**, because a transcript only records the model id. Order: what the user set for this chat, what
they set for the model, proof (a turn above 200k means 1M), `1m` in the model name, the built-in table (`DEFAULT_WINDOWS`, Opus 5.5 = 1M), then a
guess of 200k. `window_source` travels with the chat so the page can say which one applied and only offer a fix when it is a guess.

| Level | When (defaults, all overridable) |
|---|---|
| RED | context ≥95% of a 200k window, ≥90% of 1M (other sizes: `suggest_levels`, or the chat's own levels); one chat using ≥3 GB |
| AMBER | context ≥85% (200k) / ≥60% (1M); waiting on a permission prompt (with how long); one chat using ≥1.5 GB; live chat idle >1h and holding ≥150 MB; busy with no transcript output for 20 min |
| OK | otherwise |

**Machine alerts** are not about one chat, so they are separate (`system_alerts()`, the snapshot's `system` list, never counted in the chat health
tiles): all live chats together ≥25% (AMBER) / ≥40% (RED) of RAM, and free disk on the home volume <10 GB / <3 GB. They name the biggest chats
and how much old chats could free. Usage limits ≥80% are listed with the chat items but do not change any chat's health.

`suggest_levels(window)` interpolates on a log scale between the two anchors (200k: 85/95, 1M: 60/90), keeps red at least 5 points above amber, and
is mirrored in TypeScript (`lib/settings.ts`) with a parity test, because the page pre-fills the editor with it.

## Data sources (all local, all read-only)
- `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl` and `archived_sessions/`: one JSON event per line. Used: `session_meta`
  (id, cwd, originator, source, cli_version), `turn_context` (model, effort), `event_msg` of type `token_count` (token usage,
  `model_context_window`, `rate_limits`), first/latest `user_message` for prompts. Subagent threads are separate rollouts linked
  through `thread_spawn_edges` in the state database.
- `~/.codex/state_5.sqlite`, table `threads` (title, cwd, created/updated, archived), opened with `mode=ro`; the newest `state_*.sqlite` wins
  because the number is a schema version. A missing or locked database falls back to the rollouts.
- `~/.codex/session_index.jsonl` (id to thread name) and `config.toml` (default model).
- `ps` for live processes and memory.
- `~/.codex/auth.json` is never opened for tokens or keys.

## What differs from the Claude design
- **No cost.** No price table is kept; tokens only. Adding dollars would mean guessing prices and plan rules.
- **Rate limits are event-derived.** The newest `rate_limits` object in a `token_count` event is the source, shown with its age (STALE when old);
  `null` rate limits (older rollouts) are ignored.
- **Window usually known.** `model_context_window` is recorded, so the resolver order still applies but rarely falls through to a guess.
- **Liveness is inferred.** No per-pid session file exists, so a chat is live when a Codex process exists and its rollout was written recently.
- **Resume is `codex resume <id>`**, run in the chat's folder.
- **Hosts** come from the rollout's `originator`/`source` (Codex Desktop, CLI, VS Code) plus the process tree (JetBrains ACP).
- **Formats are unstable.** Parsers tolerate missing fields and unknown events, and a parse problem degrades to `?`, never a crash.
- **Skill is invoked as `$cust-codex-status`** (or `/skills`); Codex reads skills from `~/.agents/skills`, `<repo>/.agents/skills` and, on this Mac,
  `~/.codex/skills`.

## Gotchas
- macOS has no `timeout`; `sed -i` needs a backup argument. Edits to the tool were done with Python or an editor, not `sed -i`.
- curses in keypad mode expects `ESC O A/B` for arrows; sending `ESC [ A` in a pty test reads as ESC (quit).
- curses redraws only changed cells, so a pty capture of the screen after a key press may show nothing for unchanged text.
- Headless Chrome's `--window-size` will not go below ~500px; emulate a phone through the DevTools protocol instead.
- `WebServer.stop()` sets `stopped` last, so a waiter always sees the reason and a closed socket.
- With CSP `style-src 'self'`, inline `style="…"` attributes in HTML are blocked; styles set from JS (React's `style={{…}}`) are allowed.
- `web-ui` needs Node 24 LTS (or 22.22+; `engines` and `.nvmrc` say so). On Node 22.17 / npm 10.9 the install crashed resolving peers
  (`Cannot read properties of null (reading 'edgesOut')`) and jsdom 30 refused the engine; both are gone on Node 24 / npm 11, so no
  `legacy-peer-deps` or extra pins are needed.
