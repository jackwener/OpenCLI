# Browse Skill Testing Design

Two-layer testing framework for `opencli browse` commands and the
Claude Code skill integration.

## Goal

Verify that `opencli browse` works reliably on real websites and that
Claude Code can use the skill to complete browser tasks end-to-end.

## Architecture

```
autoresearch/
├── browse-tasks.json       ← 59 task definitions with browse command sequences
├── eval-browse.ts          ← Layer 1: deterministic browse command testing
├── eval-skill.ts           ← Layer 2: Claude Code skill E2E testing
├── run-browse.sh           ← Launch Layer 1
├── run-skill.sh            ← Launch Layer 2
├── baseline-browse.txt     ← Layer 1 best score
├── baseline-skill.txt      ← Layer 2 best score
└── results/                ← Per-run results (gitignored)
```

## Layer 1: Deterministic Browse Command Testing

Tests `opencli browse` commands directly on real websites. No LLM
involved — pure command reliability testing.

### How It Works

Each task defines a sequence of browse commands and a judge for the
last command's output:

```json
{
  "name": "hn-top-stories",
  "steps": [
    "opencli browse open https://news.ycombinator.com",
    "opencli browse eval \"JSON.stringify([...document.querySelectorAll('.titleline a')].slice(0,5).map(a=>({title:a.textContent,url:a.href})))\""
  ],
  "judge": { "type": "arrayMinLength", "minLength": 5 }
}
```

### Execution

```bash
./autoresearch/run-browse.sh
```

- Runs all 59 tasks serially
- Each task: execute steps → judge last step output → pass/fail
- `opencli browse close` between tasks for clean state
- Expected: ~2 minutes, $0 cost

### Task Categories

| Category | Count | Example |
|----------|-------|---------|
| extract | 9 | Open page, eval JS to extract data |
| list | 10 | Open page, eval JS to extract array |
| search | 6 | Open, type query, keys Enter, eval results |
| nav | 7 | Open, click link, eval new page title |
| scroll | 5 | Open, scroll, eval footer/hidden content |
| form | 6 | Open, type into fields, eval field values |
| complex | 6 | Multi-step: open → click → navigate → extract |
| bench | 10 | Test set (various) |

## Layer 2: Claude Code Skill E2E Testing

Spawns Claude Code with the opencli-browser skill to complete tasks
autonomously using browse commands.

### How It Works

```bash
claude -p \
  --system-prompt "$(cat skills/opencli-browser/SKILL.md)" \
  --dangerously-skip-permissions \
  --allowedTools "Bash(opencli:*)" \
  --output-format json \
  "用 opencli browse 完成任务：Extract the top 5 stories from Hacker News with title and score. Start URL: https://news.ycombinator.com"
```

### Execution

```bash
./autoresearch/run-skill.sh
```

- Runs all 59 tasks serially
- Each task: spawn Claude Code → it uses browse commands autonomously → judge output
- Expected: ~20 minutes, ~$5-10

### Judge

Both layers use the same judge types:

| Type | Description |
|------|-------------|
| `contains` | Output contains a substring |
| `arrayMinLength` | Output is an array with ≥ N items |
| `arrayFieldsPresent` | Array items have required fields |
| `nonEmpty` | Output is non-empty |
| `matchesPattern` | Output matches a regex |

## Output Format

```
🔬 Layer 1: Browse Commands — 59 tasks

  [1/59] extract-title-example... ✓ (0.5s)
  [2/59] hn-top-stories... ✓ (1.2s)
  ...

  Score: 55/59 (93%)
  Time: 2min
  Cost: $0

🔬 Layer 2: Skill E2E — 59 tasks

  [1/59] extract-title-example... ✓ (8s, $0.01)
  [2/59] hn-top-stories... ✓ (15s, $0.08)
  ...

  Score: 52/59 (88%)
  Time: 20min
  Cost: $6.50
```

## Constraints

- All 59 tasks run on real websites (no mocks)
- Layer 1: zero LLM cost, ~2 min
- Layer 2: ~$5-10 LLM cost, ~20 min
- Results saved to `autoresearch/results/` (gitignored)
- Baselines tracked in `baseline-browse.txt` and `baseline-skill.txt`

## Success Criteria

- Layer 1 ≥ 90% (browse commands work on real sites)
- Layer 2 ≥ 85% (Claude Code can use skill effectively)
- Both layers cover all 8 task categories
