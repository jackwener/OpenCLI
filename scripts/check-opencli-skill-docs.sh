#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

node scripts/sync-opencli-skill-docs.mjs >/dev/null

if ! git diff --quiet -- skills/opencli-skill/SKILL.md skills/opencli-skill/references/commands; then
  echo "❌ OpenCLI skill docs are out of sync."
  echo "Run: node scripts/sync-opencli-skill-docs.mjs"
  git --no-pager diff --name-only -- skills/opencli-skill/SKILL.md skills/opencli-skill/references/commands
  exit 1
fi

echo "✅ OpenCLI skill docs are in sync."
