#!/usr/bin/env bash
# Run the unit tests (fake data only, never reads your real ~/.codex), then optionally a smoke test on your real data.
#   tests/run.sh          unit tests
#   tests/run.sh --real   unit tests + smoke test against your real Codex data (read-only)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
python3 -m unittest discover -s "$root/tests" -v 2>&1 | tail -n 6
if [ "${1:-}" = "--real" ]; then "$root/tests/smoke.sh"; fi
