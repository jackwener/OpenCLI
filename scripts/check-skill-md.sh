#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

node scripts/sync-skill-md.mjs >/dev/null

if ! git diff --quiet -- skills/opencli-skill/SKILL.md; then
  echo "❌ SKILL.md is out of sync with src/clis/."
  echo "Run: node scripts/sync-skill-md.mjs"
  git --no-pager diff --name-only -- skills/opencli-skill/SKILL.md
  exit 1
fi

echo "✅ SKILL.md is in sync."
