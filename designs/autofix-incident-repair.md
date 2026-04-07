# AutoFix Incident Repair — Design Document

**Authors**: @opus0, @codex-mini0  
**Date**: 2026-04-07  
**Status**: Approved for Phase 1  
**Issue**: Triggered by PR #855 discussion — AutoFix cannot detect or repair CLI command-level failures

---

## Problem Statement

AutoFix currently operates as a **Repo Repair** system: it detects build errors, unit test failures, and browse-task DOM regressions, then iteratively fixes them. However, the most impactful user-facing failures — **CLI commands breaking due to site changes** — are invisible to it.

### Why AutoFix missed the twitter reply bug (#855)

1. **Build passed** — no TypeScript errors
2. **Unit tests passed** — `reply.test.ts` mocks matched the (broken) implementation
3. **Browse tests passed** — `publish-tasks.json` tests `twitter-reply-to-own-tweet` via `opencli operate` DOM scripting, not via `opencli twitter reply` CLI command

The core gap: **CLI command E2E health is not observed by any detection layer.**

### Three structural problems

| Layer | Current State | Required State |
|-------|--------------|----------------|
| **Objective** | Minimize repo error count | Restore specific command to working |
| **Observation** | build / unit test / browse-DOM score | Command exit code + structured output |
| **Scope** | `src/**/*.ts`, `extension/src/**/*.ts` | Must include `clis/**/*.ts` |

---

## Design: Two Repair Modes

Rather than replacing the existing system, we add a second mode to `fix.ts`.

### Mode A: Repo Repair (existing)

- **Trigger**: `npx tsx autoresearch/commands/fix.ts` (no args, or `--mode repo`)
- **Detection**: build → test → browse chain
- **Scope**: `src/**/*.ts`, `extension/src/**/*.ts`
- **Metric**: `error_count` (direction: lower)
- **Guard**: `npm run build`

### Mode B: Incident Repair (new)

- **Trigger**: `npx tsx autoresearch/commands/fix.ts --mode incident --spec <name>`
- **Detection**: `eval-cli.ts` runs the named command spec
- **Scope**: Per-spec `repairScope` (e.g. `clis/twitter/reply.ts`) + forbidden list
- **Metric**: `pass_count` from `eval-cli.ts` (direction: higher), only counts `failed_regression`
- **Guard**: `npm run build && npm test` (stricter — incident fix must not break repo health)

Both modes share the same Engine loop, git preconditions, logger, and metric extraction.

---

## Command Incident Spec Schema (v1)

File: `autoresearch/command-specs.json`

```json
{
  "version": 1,
  "kind": "command_incident",
  "specs": [...]
}
```

### Spec Shape

```typescript
interface CommandIncidentSpec {
  /** Unique identifier */
  name: string;
  
  /** The CLI command to execute */
  command: string;
  
  /** Safety classification — controls runner behavior */
  safety: 'read_only' | 'fill_only' | 'publish';
  
  /** Prerequisites that must be met before execution */
  prerequisites?: {
    auth?: string[];              // Required auth sessions (e.g. ["twitter"])
    env?: Record<string, string>; // Required env vars
    browserProfile?: string;      // Required browser profile
  };
  
  /** Setup steps to run before the command */
  setup?: string[];
  
  /** Verification checks — all must pass (AND semantics) */
  verify: Array<VerifyCheck>;
  
  /** Cleanup steps after execution */
  cleanup?: string[];
  
  /** Files the repair engine is allowed to modify */
  repairScope: string[];
  
  /** Files the repair engine must never modify */
  forbidden: string[];
}

type VerifyCheck =
  | { type: 'exitCode'; expected: number }
  | { type: 'stdoutContains'; value: string }
  | { type: 'jsonField'; path: string; matcher: 'nonEmpty' | 'contains' | 'gte' | 'matches'; value?: string }
  | { type: 'pageEval'; js: string; matcher: 'contains' | 'truthy' | 'equals'; value?: string };
```

### Verify Priority

```
exitCode (required) → stdoutContains / jsonField (primary) → pageEval (fallback, optional)
```

---

## eval-cli.ts — Command-Level Runner

New file: `autoresearch/eval-cli.ts`

### Execution Model

```
1. Read command-specs.json
2. Filter by --spec <name> (or run all)
3. For each spec:
   a. Check prerequisites
      → not met: classification = skipped | failed_precondition
   b. If safety = 'fill_only': inject OPENCLI_DRY_RUN=1
      If safety = 'publish' and no --allow-side-effects: skip
   c. Run setup steps (if any)
   d. Execute spec.command (timeout 60s)
      → timeout/crash: classification = failed_infrastructure
   e. Apply verify checks
      → all pass: classification = passed
      → any fail: classification = failed_regression
   f. On failure: collect artifacts (stdout, stderr, exitCode)
   g. Run cleanup steps (if any)
4. Output structured JSON summary to results/cli-NNN.json
5. Last line: SCORE=X/Y
   (X = passed count, Y = passed + failed_regression count)
   (skipped/precondition/infrastructure are excluded from score)
```

### Failure Taxonomy

| Classification | Meaning | Counted in SCORE? | Engine repairs? |
|---------------|---------|-------------------|-----------------|
| `passed` | All verify checks pass | Yes (numerator) | No |
| `failed_regression` | Command ran but verify failed | Yes (denominator) | Yes |
| `failed_precondition` | Auth/env/profile missing | No | No |
| `failed_infrastructure` | Browser bridge down, timeout | No | No |
| `skipped` | Safety profile blocked execution | No | No |

This prevents the engine from trying to "fix" auth issues or infra problems by modifying adapter code.

---

## Safety Profile

Each spec declares a `safety` level:

| Safety | Runner Behavior | Default |
|--------|----------------|---------|
| `read_only` | Execute directly | Allowed |
| `fill_only` | Inject `OPENCLI_DRY_RUN=1` | Allowed |
| `publish` | Requires `--allow-side-effects` flag | Skipped |

### OPENCLI_DRY_RUN Contract

- **Internal-only** — not a public CLI flag in Phase 1
- CLI commands check `process.env.OPENCLI_DRY_RUN` before the submit/publish step
- When set, command returns: `{ "status": "dry_run", "filled": true, "submitted": false }`
- Only applied to commands with natural "fill → submit" separation
- eval-cli.ts verifies `status=dry_run && filled=true` for fill_only specs

---

## Incident Mode Modify Prompt

The prompt given to Claude during incident repair differs from repo repair:

```
Command `{spec.command}` is failing (regression).

Last verify output:
{stdout + stderr}

Exit code: {exitCode}
Failed checks: {list of failed verify items}

The command implementation is at: {repairScope files}
Read the adapter code and fix the regression. Common causes:
- Site updated DOM selectors
- URL pattern changed
- Response format changed
- Auth/cookie handling broke

Do NOT modify: {forbidden files}
Fix ONE issue at a time.
```

---

## Phase 1 Deliverables

### Files to modify

| File | Change |
|------|--------|
| `autoresearch/commands/fix.ts` | Add `--mode repo\|incident --spec <name>` parameter; incident mode injects different config |
| `autoresearch/config.ts` | Add `CommandIncidentSpec` type definition |
| `autoresearch/eval-cli.ts` | **New.** Command-level runner with failure taxonomy + safety enforcement |
| `autoresearch/command-specs.json` | **New.** First 3 specs |
| `clis/twitter/reply.ts` | Add `OPENCLI_DRY_RUN` check before submit step |

### First 3 Command Specs

1. **`weibo-hot-smoke`** (`read_only`) — `opencli weibo hot --limit 5 -f json`
   - Verify: exitCode 0, JSON array with items containing `title`
   - No auth required

2. **`xiaohongshu-search-smoke`** (`read_only`) — `opencli xiaohongshu search 美食 --limit 3 -f json`
   - Verify: exitCode 0, JSON array length ≥ 1
   - No auth required

3. **`twitter-reply-fill-smoke`** (`fill_only`) — `opencli twitter reply --url <url> --text 'smoke test'`
   - Verify: exitCode 0, stdout contains `dry_run`, filled = true
   - Requires: auth twitter
   - Uses `OPENCLI_DRY_RUN=1`

### Explicitly NOT in Phase 1

- ❌ Auto-dispatch (issue → spec mapping)
- ❌ AI-based failure classification (deterministic rules only)
- ❌ `publish` safety specs
- ❌ `repairScope` primary/secondary escalation
- ❌ `eval-all.ts` integration
- ❌ Session/auth bootstrap
- ❌ Public `--dry-run` CLI flag

---

## Phase 2+ Roadmap (out of scope)

- Issue/diagnostic → spec auto-mapping
- Auto-dispatch: user report triggers incident repair
- `repairScope` primary → secondary escalation on stuck
- More command specs (twitter/post, zhihu/answer, etc.)
- `eval-all.ts` integration with eval-cli.ts
- Failure artifact collection (screenshots, diagnostics)

---

## Usage Examples

```bash
# Repo repair (existing behavior, unchanged)
npx tsx autoresearch/commands/fix.ts
npx tsx autoresearch/commands/fix.ts --mode repo

# Incident repair — fix a specific command
npx tsx autoresearch/commands/fix.ts --mode incident --spec weibo-hot-smoke

# Dry-run eval-cli only (no engine loop)
npx tsx autoresearch/eval-cli.ts
npx tsx autoresearch/eval-cli.ts --spec twitter-reply-fill-smoke

# Run all command specs
npx tsx autoresearch/eval-cli.ts
```
