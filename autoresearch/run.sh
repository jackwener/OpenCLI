#!/bin/bash
# AutoResearch launcher for OpenCLI Operate
#
# Usage:
#   ./autoresearch/run.sh              # Run with defaults
#   ./autoresearch/run.sh --rounds 5   # Suggest round count in prompt

set -e
cd "$(dirname "$0")/.."

# Ensure build is current
echo "Building OpenCLI..."
npm run build > /dev/null 2>&1
echo "Build OK"

# Read current baseline
BASELINE="0/20"
if [ -f autoresearch/baseline.txt ]; then
  BASELINE=$(cat autoresearch/baseline.txt)
fi
echo "Current baseline: $BASELINE"
echo ""

# Count existing rounds
ROUNDS=$(ls autoresearch/results/round-*.json 2>/dev/null | wc -l | tr -d ' ')
echo "Completed rounds: $ROUNDS"
echo ""

# Launch Claude Code
echo "Starting AutoResearch session..."
echo "─────────────────────────────────"

claude -p \
  --dangerously-skip-permissions \
  --model sonnet \
  --system-prompt "$(cat autoresearch/program.md)" \
  "You are starting an AutoResearch session for opencli operate.

Current baseline: $BASELINE
Completed rounds: $ROUNDS

Read autoresearch/tasks.json to understand the evaluation tasks.
$([ "$ROUNDS" -gt 0 ] && echo "Read the latest result file in autoresearch/results/ to understand what was tried before.")

Your goal: improve the success rate by modifying src/agent/ files.
Run the eval loop: analyze → modify → build → eval → commit or revert.
Aim for 10-20 rounds of iteration.

Start by running the eval to establish/verify the current baseline:
  npx tsx autoresearch/eval.ts"
