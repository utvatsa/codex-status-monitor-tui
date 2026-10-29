#!/usr/bin/env bash
# Install cust-codex-status by symlinking it, so the repo stays the single source of truth.
#
#   ./install.sh            install (safe to run again)
#   ./install.sh --dry-run  show what would happen, change nothing
#   ./install.sh --no-web   install with the optional web view turned off (turn it on later: ./install.sh --web)
#   ./install.sh --web      turn the web view (back) on; it is on by default
#
# What it creates (symlinks only; nothing is copied, no packages are installed, no dotfiles are edited):
#   ~/.codex/bin/cust-codex-status      the $cust-codex-status skill calls this path
#   ~/.local/bin/cust-codex-status       puts the command on your PATH (add ~/.local/bin to PATH if it is not there)
#   ~/.codex/skills/cust-codex-status   the $cust-codex-status skill for Codex
# It never overwrites a real file or folder: if one is in the way it tells you and skips it (move it aside first).
# --web / --no-web also write ~/.config/cust-codex-status/config.json ({"web": true|false}); nothing else outside the links.
# Prefer a regular Python install?  pip install .   (adds a `cust-codex-status` command; the skill still needs the symlinks above)
set -euo pipefail

dry=0
web=""
for a in "$@"; do
  case "$a" in
    --dry-run) dry=1 ;;
    --web) web=on ;;
    --no-web) web=off ;;
    *) echo "unknown option: $a (use --dry-run, --web or --no-web)" >&2; exit 2 ;;
  esac
done
here="$(cd "$(dirname "$0")" && pwd)"

if ! command -v python3 >/dev/null || ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))'; then
  echo "error: Python 3.9 or newer is required (found: $(python3 --version 2>&1 || echo none))" >&2
  exit 1
fi

link() {  # link <target> <link path>
  local target="$1" path="$2"
  if [ -L "$path" ] && [ "$(readlink "$path")" = "$target" ]; then echo "ok       $path (already linked)"; return; fi
  local aside="$HOME/old-$(basename "$(dirname "$path")")-$(basename "$path")"
  if [ -e "$path" ] && [ ! -L "$path" ]; then echo "SKIPPED  $path exists and is not a symlink (a real file/folder, e.g. an older hand-made install). Move it aside, e.g.: mv \"$path\" \"$aside\"  (a skill folder must leave ~/.codex/skills entirely, or two skills share one name), then run this again"; skipped=1; return; fi
  if [ "$dry" = 1 ]; then echo "would link $path -> $target"; return; fi
  mkdir -p "$(dirname "$path")"
  ln -sfn "$target" "$path"
  echo "linked   $path -> $target"
}

skipped=0
link "$here/bin/cust-codex-status" "$HOME/.codex/bin/cust-codex-status"
link "$here/bin/cust-codex-status" "$HOME/.local/bin/cust-codex-status"
link "$here/skill/cust-codex-status" "$HOME/.codex/skills/cust-codex-status"

if [ -n "$web" ]; then
  if [ "$dry" = 1 ]; then echo "would turn the web view $web (~/.config/cust-codex-status/config.json)"
  else "$here/bin/cust-codex-status" --set-web "$web"; fi
fi

case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "note: ~/.local/bin is not on your PATH, so only $cust-codex-status and ~/.codex/bin/cust-codex-status will work";; esac
if [ "$dry" = 1 ]; then echo "dry run: nothing changed"; exit 0; fi
[ "$skipped" = 1 ] && { echo "finished with skipped items (see above)"; exit 1; }
echo "installed: $("$here/bin/cust-codex-status" --version)"
echo "try:       cust-codex-status          (or cust-codex-status -t for the full-screen view)"
if python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); from cust_codex_status.config import web_enabled; sys.exit(0 if web_enabled() else 1)' "$here/src"; then
  echo "web view:  cust-codex-status --web    (on; ./install.sh --no-web turns it off)"
else
  echo "web view:  off (./install.sh --web turns it on)"
fi
echo "remove:    $here/uninstall.sh"
