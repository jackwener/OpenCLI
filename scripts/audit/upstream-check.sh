#!/usr/bin/env bash
# Report upstream (jackwener/opencli) changes since .audit-baseline.
# Read-only; no merges, no modifications.
# Reference: .audit/specs/2026-04-17-opencli-safe-usage-design.md §7.2
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if [ ! -f .audit-baseline ]; then
  echo "❌ .audit-baseline not found (is this the right repo?)"
  exit 1
fi

if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "❌ 'upstream' remote not configured"
  echo "   Fix: git remote add upstream git@github.com:jackwener/opencli.git"
  exit 1
fi

if ! git fetch upstream --tags --quiet 2>/dev/null; then
  echo "❌ Cannot fetch upstream (network/auth issue?)"
  exit 1
fi

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

# Run a query and report failure explicitly. With pipefail enabled, any
# component of `cmd | filter` that exits non-zero would abort the script,
# so each section is wrapped to keep the report flowing while making
# failures visible.
run_section() {
  local title="$1"
  shift
  echo ""
  echo "=== ${title} ==="
  # Capture the exit code BEFORE entering the if branch — inside the
  # `then` block of `if ! cmd`, $? has already been overwritten to 0
  # because the test succeeded, so the original failure code is gone.
  local rc=0
  "$@" || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "⚠️  section failed (exit $rc)"
  fi
}

high_risk_diff() {
  git diff --stat "$CURRENT..$NEW" -- \
    extension/ src/browser/ src/daemon.ts src/daemon-client.ts \
    scripts/ package.json package-lock.json \
    .github/workflows/ | tail -20
}

adapter_changes() {
  git log --name-only --format="" "$CURRENT..$NEW" -- clis/ \
    | awk -F/ '/^clis\//{print $2}' | sort -u | head -30
}

tag_releases() {
  git tag --contains "$CURRENT" | head -5
  if command -v gh >/dev/null 2>&1; then
    gh release list --repo jackwener/opencli --limit 3 || echo "(gh release list failed)"
  fi
}

security_advisories() {
  if command -v gh >/dev/null 2>&1; then
    gh api repos/jackwener/opencli/security-advisories | head || echo "(none or API unavailable)"
  else
    echo "(gh CLI not installed; check manually at https://github.com/jackwener/opencli/security/advisories)"
  fi
}

run_section "🔴 High-risk directories (diff stat)" high_risk_diff
run_section "🟢 Adapter changes (grouped by site)" adapter_changes
run_section "Tags / Releases" tag_releases
run_section "Security advisories" security_advisories

echo ""
echo "--- Next steps (see spec §7.3 decision tree) ---"
echo "  Q1: CVE/advisory present?  yes → §7.4 urgent response"
echo "  Q2: high-risk dirs changed? yes → §7.5 half-auto sync"
echo "  Q3: adapters/docs only?    yes → §7.6 cherry-pick"
