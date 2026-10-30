#!/usr/bin/env bash
# Remove what install.sh created: the three symlinks, and only if they are symlinks into this repo.
# Real files, other symlinks and this repo itself are never touched.
#
#   ./uninstall.sh            remove
#   ./uninstall.sh --dry-run  show what would be removed
set -euo pipefail

dry=0
[ "${1:-}" = "--dry-run" ] && dry=1
here="$(cd "$(dirname "$0")" && pwd)"

unlink_ours() {  # unlink_ours <link path> <expected target>
  local path="$1" target="$2"
  if [ ! -e "$path" ] && [ ! -L "$path" ]; then echo "absent   $path"; return; fi
  if [ ! -L "$path" ]; then echo "kept     $path is a real file/folder, not ours"; return; fi
  if [ "$(readlink "$path")" != "$target" ]; then echo "kept     $path points somewhere else ($(readlink "$path"))"; return; fi
  if [ "$dry" = 1 ]; then echo "would remove $path"; return; fi
  rm "$path"
  echo "removed  $path"
}

unlink_ours "$HOME/.codex/bin/cust-codex-status" "$here/bin/cust-codex-status"
unlink_ours "$HOME/.local/bin/cust-codex-status" "$here/bin/cust-codex-status"
unlink_ours "$HOME/.codex/skills/cust-codex-status" "$here/skill/cust-codex-status"
[ -f "$HOME/.config/cust-codex-status/config.json" ] && echo "kept     ~/.config/cust-codex-status/config.json (the web view switch; delete it by hand if you like)"
[ "$dry" = 1 ] && echo "dry run: nothing changed" || echo "done. The repo at $here is untouched; run ./install.sh to link it again."
