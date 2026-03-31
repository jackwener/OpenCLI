# AutoResearch: OpenCLI Operate Optimization

## Your Mission

You are an AI researcher optimizing `opencli operate` — a browser automation
agent. Your goal: maximize the task success rate on a fixed evaluation set.

## Current State

- Baseline score: see `autoresearch/baseline.txt`
- Latest results: see `autoresearch/results/` (most recent round file)
- Agent code: `src/agent/` (all files are modifiable)

## The Loop

For each round:

1. **Analyze** — Read the latest eval results. Which tasks failed? Why?
2. **Hypothesize** — Form a theory about what to change
3. **Modify** — Edit files in `src/agent/`
4. **Build** — Run `npm run build`. Must compile cleanly.
5. **Evaluate** — Run `npx tsx autoresearch/eval.ts --train-only` for quick feedback
6. **Decide** — If train score improved:
   - Run `npx tsx autoresearch/eval.ts` (full eval including test set)
   - If total score >= baseline: `git commit` and update `autoresearch/baseline.txt`
   - If total score < baseline: `git revert`
7. **Log** — Record what you tried and why it worked or didn't

## Rules

### MUST
- Only modify files in `src/agent/`
- Run `npm run build` after every change (must compile)
- Run eval to measure impact before committing
- Commit with message: `autoresearch: {score} — {what changed}`
- Make BOLD changes. Small parameter tweaks get lost in variance.

### MUST NOT
- Do NOT modify `autoresearch/eval.ts` or `autoresearch/tasks.json`
- Do NOT hardcode logic for specific task names or URLs
- Do NOT modify files outside `src/agent/`
- Do NOT skip the eval step

## Strategy Guide

### What tends to work (from Browser Use's experience)
- **Prompt rewrites** often beat code changes
- **DOM format changes** (e.g., more concise serialization) save tokens and improve accuracy
- **Action strategy changes** (when to scroll, how to verify input) fix entire categories of failures
- **Better error messages** to the LLM help it self-correct

### Common failure root causes
- Element not in viewport → agent types into wrong element
- LLM uses wrong element index (index from previous step, element moved)
- LLM calls `done` prematurely without completing all requirements
- LLM hallucinates data instead of extracting from page
- Autocomplete fields not handled (need to wait for suggestions)
- Page loads slowly, DOM snapshot captures loading/skeleton state

### What to look at when analyzing failures
- How many steps did the failing task use? (max_steps = ran out of time)
- Did the LLM ever see the correct data in the DOM snapshot?
- Did actions report success but not actually work?
- Was the evaluation judge too strict or too lenient?

## Files You Can Modify

| File | Purpose | Impact |
|------|---------|--------|
| `src/agent/prompts.ts` | System prompt, step messages | HIGH — directly controls LLM behavior |
| `src/agent/agent-loop.ts` | Core loop, planning, loop detection | HIGH — controls flow and recovery |
| `src/agent/action-executor.ts` | How actions are executed | HIGH — click/type/scroll reliability |
| `src/agent/dom-context.ts` | DOM snapshot + element info | HIGH — what the LLM "sees" |
| `src/agent/types.ts` | Action schemas, response format | MEDIUM — changes what LLM can do |
| `src/agent/llm-client.ts` | LLM API wrapper | LOW — mostly infrastructure |
| `src/agent/trace-recorder.ts` | Network capture | LOW — only affects skill generation |
| `src/agent/api-discovery.ts` | API scoring | LOW — only affects skill generation |
| `src/agent/skill-saver.ts` | TS code generation | LOW — only affects --save-as |
| `src/agent/cli-handler.ts` | CLI bridge | LOW — mostly boilerplate |

Focus on the HIGH impact files first.

## Example Round

```
Round 5:
  Previous: 14/20
  Analysis: 3 tasks fail because LLM calls done after filling only visible
    form fields, missing fields below the fold. 1 task fails because extract
    returns empty (page still loading).
  Change: Added rule to prompts.ts: "Before calling done on form tasks,
    scroll to bottom to verify all fields are filled." Also added 1s wait
    after navigate in action-executor.ts.
  Train eval: 16/15 → improvement
  Full eval: 17/20 → improvement over 14/20
  Action: git commit "autoresearch: 17/20 — scroll-before-done rule + post-navigate wait"
  Updated baseline.txt to 17/20
```
