#!/usr/bin/env bash
# Daily-brief helper: invoke last30days for one topic and persist the context blob.
#
# Usage:
#   bash run_last30days.sh "electric vehicles battery supply chain" ev-batteries
#   bash run_last30days.sh "indie games steam launches" indie-games --mock
#
# Writes:
#   ${DAILY_BRIEF_LAST30DAYS_DIR:-${DAILY_BRIEF_HOME:-.daily-brief}/last30days}/<YYYY-MM-DD>-<slug>.md
#
# Stdout is only the output file path so SKILL.md can capture it cleanly.
set -euo pipefail

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

TOPIC="${1:-}"
SLUG="${2:-}"
EXTRA_ARGS=("${@:3}")
if [[ -z "$TOPIC" ]]; then
  echo "ERROR: topic argument required" >&2
  echo "Usage: bash run_last30days.sh \"<topic>\" [slug] [last30days args...]" >&2
  exit 2
fi
if [[ -z "$SLUG" ]]; then
  SLUG=$(printf '%s' "$TOPIC" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-' | cut -c1-50)
fi

LAST30="$SKILL_DIR/vendor/last30days/scripts/last30days.py"
if [[ -z "$LAST30" || ! -f "$LAST30" ]]; then
  echo "ERROR: bundled last30days.py not found at $LAST30. Run check_prereqs.sh first." >&2
  exit 3
fi

PYTHON_BIN=""
BRIEF_HOME="${DAILY_BRIEF_HOME:-.daily-brief}"
if [[ -f "$BRIEF_HOME/cache/last30days_python" ]]; then
  cached_python="$(cat "$BRIEF_HOME/cache/last30days_python")"
  if [[ -n "$cached_python" && -x "$cached_python" ]]; then
    PYTHON_BIN="$cached_python"
  fi
fi
if [[ -z "$PYTHON_BIN" ]]; then
  PYTHON_BIN="$(find_python312 || true)"
fi
if [[ -z "$PYTHON_BIN" ]]; then
  echo "ERROR: Python 3.12+ not found. Set PYTHON=/path/to/python3.12 or run check_prereqs.sh." >&2
  exit 3
fi

OUT_DIR="${DAILY_BRIEF_LAST30DAYS_DIR:-$BRIEF_HOME/last30days}"
mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/$(date +%Y-%m-%d)-${SLUG}.md"

echo "[daily_last30days] topic: $TOPIC" >&2
echo "[daily_last30days] writing: $OUT_FILE" >&2

if ! "$PYTHON_BIN" "$LAST30" --emit=context ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} "$TOPIC" > "$OUT_FILE"; then
  echo "ERROR: last30days exited non-zero. Partial output (if any) is at $OUT_FILE" >&2
  exit 4
fi
if [[ ! -s "$OUT_FILE" ]]; then
  echo "ERROR: last30days produced empty output at $OUT_FILE" >&2
  exit 5
fi

echo "$OUT_FILE"
