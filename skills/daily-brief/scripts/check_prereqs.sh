#!/usr/bin/env bash
# Verify all prerequisites for daily-brief. Prints actionable install hints.
# Exits 0 if everything is fine, non-zero otherwise.
set -u

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }

fail=0
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

find_python312() {
  local candidate
  for candidate in "${PYTHON:-}" python3.12 python3; do
    [[ -n "$candidate" ]] || continue
    command -v "$candidate" >/dev/null 2>&1 || continue
    if "$candidate" - <<'PY' >/dev/null 2>&1
import sys
raise SystemExit(0 if sys.version_info >= (3, 12) else 1)
PY
    then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

# --- 1. Bundled last30days runtime ---
LAST30="$SKILL_DIR/vendor/last30days/scripts/last30days.py"
if [[ -f "$LAST30" && -d "$SKILL_DIR/vendor/last30days/scripts/lib" ]]; then
  green "[OK] bundled last30days runtime: $LAST30"
else
  red "[FAIL] bundled last30days runtime missing."
  echo "      expected: $SKILL_DIR/vendor/last30days/scripts/last30days.py"
  fail=1
fi

PYTHON312="$(find_python312 || true)"
if [[ -n "$PYTHON312" ]]; then
  pyver=$("$PYTHON312" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")')
  green "[OK] Python for bundled last30days: $PYTHON312 ($pyver)"
else
  red "[FAIL] Python 3.12+ not found; bundled last30days v3 requires Python 3.12+."
  echo "      Install python3.12+ or set PYTHON=/path/to/python3.12 before running daily-brief."
  fail=1
fi

# --- 2. Storage dirs ---
BRIEF_HOME="${DAILY_BRIEF_HOME:-.daily-brief}"
mkdir -p "$BRIEF_HOME/briefings"
green "[OK] Briefings dir: $BRIEF_HOME/briefings"
mkdir -p "$BRIEF_HOME/last30days"
green "[OK] last30days dir: $BRIEF_HOME/last30days"
mkdir -p "$BRIEF_HOME/cache"
green "[OK] Cache dir: $BRIEF_HOME/cache"
if [[ -f "$LAST30" ]]; then
  echo "$LAST30" > "$BRIEF_HOME/cache/last30days_path"
fi
if [[ -n "$PYTHON312" ]]; then
  echo "$PYTHON312" > "$BRIEF_HOME/cache/last30days_python"
fi

# --- 3. General Python availability ---
if command -v python3 >/dev/null 2>&1; then
  ver=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
  green "[OK] python3 $ver"
else
  red "[FAIL] python3 not found in PATH"
  fail=1
fi

if [[ $fail -eq 0 ]]; then
  green ""
  green "Research prerequisites satisfied. /daily-brief is ready."
  exit 0
else
  red ""
  red "One or more prerequisites missing. Fix the items above and re-run."
  exit 1
fi
