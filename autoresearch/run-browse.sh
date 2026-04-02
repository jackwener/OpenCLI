#!/bin/bash
# Layer 1: Deterministic browse command testing
set -e
cd "$(dirname "$0")/.."
echo "Building OpenCLI..."
npm run build > /dev/null 2>&1
echo "Build OK"
echo ""
npx tsx autoresearch/eval-browse.ts "$@"
