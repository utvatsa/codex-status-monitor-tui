#!/usr/bin/env bash
# Smoke test on YOUR real data (read-only): every view level renders and --json parses.
set -euo pipefail
tool="$(cd "$(dirname "$0")/.." && pwd)/bin/cust-codex-status"
"$tool" --version
"$tool" --help >/dev/null
for l in 0 10 30 60 75 95 100; do "$tool" --no-color --level "$l" >/dev/null && echo "level $l ok"; done
"$tool" --json | python3 -c 'import json,sys; d=json.load(sys.stdin); assert "sessions" in d; print("json ok:", len(d["sessions"]), "sessions")'
echo "all good"
