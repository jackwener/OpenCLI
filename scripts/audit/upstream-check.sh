#!/usr/bin/env bash
# Report upstream (jackwener/opencli) changes since .audit-baseline.
# Read-only; no merges, no modifications.
# Reference: .audit/specs/2026-04-17-opencli-safe-usage-design.md §7.2
set -e

cd "$(git rev-parse --show-toplevel)"

if [ ! -f .audit-baseline ]; then
  echo "❌ .audit-baseline not found (is this the right repo?)"
  exit 1
fi

git fetch upstream --tags --quiet 2>/dev/null || {
  echo "❌ Cannot fetch upstream (is 'upstream' remote configured?)"
  echo "   Fix: git remote add upstream git@github.com:jackwener/opencli.git"
  exit 1
}

CURRENT=$(cat .audit-baseline)
NEW=$(git rev-parse upstream/main)

if [ "$CURRENT" = "$NEW" ]; then
  echo "✅ No upstream changes since baseline $CURRENT"
  exit 0
fi

COMMITS=$(git rev-list --count "$CURRENT..$NEW")
echo "⚠️  $COMMITS new commits (baseline → upstream/main)"
echo "   baseline: $CURRENT"
echo "   upstream: $NEW"

echo ""
echo "=== 🔴 High-risk directories (diff stat) ==="
git diff --stat "$CURRENT..$NEW" -- \
  extension/ src/browser/ src/daemon.ts src/daemon-client.ts \
  scripts/ package.json package-lock.json \
  .github/workflows/ 2>/dev/null | tail -20

echo ""
echo "=== 🟢 Adapter changes (grouped by site) ==="
git log --name-only --format="" "$CURRENT..$NEW" -- clis/ 2>/dev/null \
  | awk -F/ '/^clis\//{print $2}' | sort -u | head -30

echo ""
echo "=== Tags / Releases ==="
git tag --contains "$CURRENT" | head -5
command -v gh >/dev/null && gh release list --repo jackwener/opencli --limit 3 2>/dev/null

echo ""
echo "=== Security advisories ==="
if command -v gh >/dev/null 2>&1; then
  gh api repos/jackwener/opencli/security-advisories 2>/dev/null | head || echo "(none or API unavailable)"
else
  echo "(gh CLI not installed; check manually at https://github.com/jackwener/opencli/security/advisories)"
fi

echo ""
echo "--- Next steps (see spec §7.3 decision tree) ---"
echo "  Q1: CVE/advisory present?  yes → §7.4 urgent response"
echo "  Q2: high-risk dirs changed? yes → §7.5 half-auto sync"
echo "  Q3: adapters/docs only?    yes → §7.6 cherry-pick"
