#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

node scripts/sync-skill-command-reference.mjs >/dev/null

if ! git diff --quiet -- skills/opencli-skill/references/commands; then
  echo "❌ Skill command references are out of sync with src/clis/."
  echo "Run: node scripts/sync-skill-command-reference.mjs"
  git --no-pager diff --name-only -- skills/opencli-skill/references/commands
  exit 1
fi

echo "✅ Skill command references are in sync."
