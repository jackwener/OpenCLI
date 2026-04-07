# Self-Repair Protocol — Design Document

**Authors**: @opus0, @codex-mini0  
**Date**: 2026-04-07  
**Status**: Approved  
**Supersedes**: `designs/autofix-incident-repair.md` (PR #863, deferred to Phase 2)

---

## Problem Statement

When an AI agent uses `opencli <site> <command>` and the command fails (site changed DOM, API, or response schema), the agent should **automatically repair the adapter and retry** — without human intervention or pre-written spec files.

### Why the simpler approach

The previous design (PR #863) required pre-authoring `command-specs.json` with verify checks, safety profiles, and failure taxonomy before any command could be repaired. This created a chicken-and-egg problem: you can only repair commands you've already written specs for.

From first principles, the agent already has everything it needs:
1. **The failing command** — it just ran it
2. **The error output** — stdout/stderr
3. **The adapter source** — resolved via `RepairContext.adapter.sourcePath`
4. **Diagnostic context** — DOM snapshot, network requests (via `OPENCLI_DIAGNOSTIC=1`)
5. **A verify oracle** — re-run the same command

No spec file needed. The command itself is the spec.

---

## Design: Online Self-Repair

### Core Protocol

```
Agent runs: opencli <site> <command> [args...]
  → Command succeeds → continue task
  → Command fails →
      1. Re-run with OPENCLI_DIAGNOSTIC=1 to collect RepairContext
      2. Read adapter source from RepairContext.adapter.sourcePath
      3. Analyze: error code + DOM snapshot + network requests → root cause
      4. Edit the adapter file at RepairContext.adapter.sourcePath
      5. Retry the original command
      6. If still failing → repeat (max 3 rounds)
      7. If 3 rounds exhausted → report failure, do not loop further
```

### Scope Constraint

**Only modify the adapter file identified by `RepairContext.adapter.sourcePath`.**

The diagnostic resolves the actual editable source path at runtime — it may be:
- `clis/<site>/*.ts` — repo-local adapters (dev/source checkout)
- `~/.opencli/clis/<site>/*.ts` — user-local adapters (npm install scenario)

The agent must use the path from the diagnostic, not guess a repo-relative path. This is critical for npm-installed users where `clis/` is not in the repo.

**Never modify:**
- `src/**` — core runtime (npm package, requires version release)
- `extension/**` — browser extension
- `autoresearch/**` — research infrastructure
- `tests/**` — test files
- `package.json`, `tsconfig.json` — project config

### When NOT to Self-Repair

The agent should recognize non-repairable failures and stop:

| Signal | Meaning | Action |
|--------|---------|--------|
| Auth/login error | Not logged into site in Chrome | Tell user to log in, don't modify code |
| Browser bridge not connected | Extension/daemon not running | Tell user to run `opencli doctor` |
| CAPTCHA | Site requires human verification | Report, don't modify code |
| Rate limited / IP blocked | Not an adapter issue | Report, wait and retry later |
| Feature removed by site | Data no longer exists | Report, adapter may need deprecation |

### Retry Budget

- **Max 3 repair rounds per command failure**
- Each round: diagnose → edit adapter → retry command
- If the error is identical after a repair attempt, the fix didn't work — try a different approach
- After 3 rounds, stop and report what was tried

---

## Implementation

### What Already Exists

| Component | Status | Location |
|-----------|--------|----------|
| Diagnostic output (RepairContext) | ✅ Done | `src/diagnostic.ts` |
| Diagnostic wiring in execution | ✅ Done | `src/execution.ts` |
| Error taxonomy (CliError codes) | ✅ Done | `src/errors.ts` |
| Adapter source resolution | ✅ Done | `src/diagnostic.ts:resolveAdapterSourcePath` |

### What's New (This Design)

| Component | Description |
|-----------|-------------|
| `skills/opencli-autofix/SKILL.md` (renamed from `opencli-repair`) | AutoFix skill with safety boundaries, sourcePath-based scope, 3-round limit. The primary delivery mechanism for the self-repair protocol. |
| `skills/opencli-usage/SKILL.md` (updated) | Self-Repair section for discoverability |

### Delivery mechanism

The `opencli-autofix` skill is the portable self-repair protocol. Any AI agent — regardless of framework, provider, or working directory — can load this skill to get the full autofix workflow. It is not tied to any specific agent framework or repo location.

- **No new runtime code** — the diagnostic infrastructure already exists
- **No CLAUDE.md dependency** — the skill is the protocol, not a repo-local file

---

## The AutoFix Protocol (in the skill)

The `opencli-autofix` skill instructs agents:

1. When `opencli <site> <command>` fails, **don't just report the error**
2. Re-run with `OPENCLI_DIAGNOSTIC=1` to get structured context
3. Parse the RepairContext (error code, adapter source, DOM snapshot)
4. Read and fix the adapter at `RepairContext.adapter.sourcePath`
5. Retry the original command
6. Max 3 repair rounds, then stop

---

## Relationship to PR #863

PR #863 (spec/runner/incident framework) is **not needed for Phase 1**. It becomes useful later as a "hardening layer":

- **Phase 1 (now)**: Self-Repair via `opencli-autofix` skill — agent repairs on the fly
- **Phase 2 (later)**: High-frequency failures get hardened into `command-specs.json` for offline regression testing and CI

The spec/runner framework is the "asset layer" — it turns ad-hoc repairs into reusable, verifiable test cases. But it's not the entry point.

---

## Usage

No new commands. No new scripts. The agent loads the `opencli-autofix` skill and uses opencli normally:

```bash
# Agent runs a command as part of its task
opencli weibo hot --limit 5 -f json

# If it fails, the agent automatically:
# 1. Runs OPENCLI_DIAGNOSTIC=1 opencli weibo hot --limit 5 -f json 2>diag.json
# 2. Reads the diagnostic context
# 3. Fixes the adapter at RepairContext.adapter.sourcePath
# 4. Retries: opencli weibo hot --limit 5 -f json
# 5. Continues with the task
```
