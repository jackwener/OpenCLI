# V2EX AutoResearch Test Suite Design

## Goal

Build a comprehensive test suite using V2EX (https://v2ex.com/) as the single target website to iteratively improve OpenCLI Operate's reliability and Claude Code skill effectiveness. Run 10 rounds of AutoResearch iteration (5 code-level + 5 SKILL.md-level).

## Test Suite Structure — 5 Layers, 40 Tasks

### Layer 1: Atomic (10 tasks)
Single operate commands testing command-level reliability.

### Layer 2: Single Page (10 tasks)
Meaningful extraction/interaction within one page.

### Layer 3: Multi-Step (10 tasks)
Cross-page navigation + extraction combos.

### Layer 4: Write Operations (5 tasks)
Login-required write operations (reply, favorite, thank).

### Layer 5: Complex Chain (5 tasks)
Long chains: cross-post reference, multi-node comparison, full workflows.

## Test Infrastructure

- **v2ex-tasks.json** — Layer 1 deterministic tasks (browse commands + judge criteria)
- **eval-v2ex.ts** — Runner for V2EX tasks (reuses eval-browse.ts pattern)
- **v2ex-skill-tasks** — Layer 2 LLM E2E tasks embedded in eval runner
- **presets/v2ex-reliability.ts** — AutoResearch preset for code optimization
- **presets/v2ex-skill.ts** — AutoResearch preset for SKILL.md optimization

## AutoResearch Iteration Plan

- Rounds 1-5: Layer 1 preset → optimize src/browser/*.ts code
- Rounds 6-10: Layer 2 preset → optimize skills/opencli-operate/SKILL.md
- Alternating: fix code issues first, then improve LLM guidance

## Success Criteria

- Layer 1 baseline → target 100% pass rate after 5 code iterations
- Layer 2 baseline → target 100% pass rate after 5 SKILL.md iterations
