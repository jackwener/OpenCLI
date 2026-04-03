#!/usr/bin/env bash
# Layer 4: Save as CLI — test the full save pipeline
# Tests: operate init → write adapter → operate verify
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Layer 4: Save as CLI ==="
echo "Testing: init → write → verify pipeline"
echo ""

npx tsx autoresearch/eval-save.ts "$@"
