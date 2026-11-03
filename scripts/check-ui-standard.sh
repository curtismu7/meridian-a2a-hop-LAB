#!/usr/bin/env bash
# UI standard check: delegate to the shared checker beside this repo when present.
set -eu
here="$(cd "$(dirname "$0")/.." && pwd)"
shared="$here/../../scripts/check-ui-standard.sh"
if [ -f "$shared" ]; then exec bash "$shared" "$here"; fi
echo "shared check-ui-standard.sh not found; skipped"
