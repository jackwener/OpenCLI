#!/bin/bash
# Layer 2: Claude Code skill E2E testing
set -e
cd "$(dirname "$0")/.."
echo "Building OpenCLI..."
npm run build > /dev/null 2>&1
echo "Build OK"
echo ""
npx tsx autoresearch/eval-skill.ts "$@"
