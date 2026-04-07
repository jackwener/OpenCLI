# Self-Repair Protocol — Design Document

**Authors**: @opus0, @codex-mini0  
**Date**: 2026-04-07  
**Status**: Approved  
**Supersedes**: `designs/autofix-incident-repair.md` (PR #863, deferred to Phase 2)

---

## Problem Statement

When a Claude agent working in the opencli repo uses `opencli <site> <command>` and the command fails (site changed DOM, API, or response schema), the agent should **automatically repair the adapter and retry** — without human intervention or pre-written spec files. For npm-installed users, agents can explicitly load the `opencli-repair` skill to get the same protocol.

### Why the simpler approach

The previous design (PR #863) required pre-authoring `command-specs.json` with verify checks, safety profiles, and failure taxonomy before any command could be repaired. This created a chicken-and-egg problem: you can only repair commands you've already written specs for.

From first principles, the agent already has everything it needs:
1. **The failing command** — it just ran it
2. **The error output** — stdout/stderr
3. **The adapter source** — `clis/<site>/xxx.ts`
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
      4. Edit the adapter file (clis/<site>/ only)
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
| Repair skill (manual) | ✅ Done | `skills/opencli-repair/SKILL.md` |
| Error taxonomy (CliError codes) | ✅ Done | `src/errors.ts` |
| Adapter source resolution | ✅ Done | `src/diagnostic.ts:resolveAdapterSourcePath` |

### What's New (This Design)

| Component | Description |
|-----------|-------------|
| `CLAUDE.md` | Project-level instructions for Claude agents working in the opencli repo |
| `skills/opencli-repair/SKILL.md` (updated) | Safety boundaries, sourcePath-based scope, 3-round limit |
| `skills/opencli-usage/SKILL.md` (updated) | Self-Repair section for discoverability |

### Delivery channels

| Scenario | Mechanism | Auto-loaded? |
|----------|-----------|-------------|
| Agent working in opencli repo | `CLAUDE.md` | Yes (Claude Code auto-loads) |
| Agent using opencli from npm install | `opencli-repair` skill | No (must be explicitly loaded) |
| Runtime auto-trigger (any agent) | Not yet built (Phase 2) | — |

- **No code changes** — the diagnostic infrastructure and repair skill already exist
- **Composable** — `CLAUDE.md` provides the auto-trigger; `opencli-repair` skill provides the detailed workflow

---

## CLAUDE.md Self-Repair Section

The CLAUDE.md instructs agents:

1. When `opencli <site> <command>` fails, **don't just report the error**
2. Re-run with `OPENCLI_DIAGNOSTIC=1` to get structured context
3. Parse the RepairContext (error code, adapter source, DOM snapshot)
4. Read and fix the adapter at `RepairContext.adapter.sourcePath`
5. Only edit the file at `RepairContext.adapter.sourcePath`
6. Retry the original command
7. Max 3 repair rounds, then stop

---

## Relationship to PR #863

PR #863 (spec/runner/incident framework) is **not needed for Phase 1**. It becomes useful later as a "hardening layer":

- **Phase 1 (now)**: Self-Repair via CLAUDE.md — agent repairs on the fly
- **Phase 2 (later)**: High-frequency failures get hardened into `command-specs.json` for offline regression testing and CI

The spec/runner framework is the "asset layer" — it turns ad-hoc repairs into reusable, verifiable test cases. But it's not the entry point.

---

## Usage

No new commands. No new scripts. The agent just uses opencli normally:

```bash
# Agent runs a command as part of its task
opencli weibo hot --limit 5 -f json

# If it fails, the agent automatically:
# 1. Runs OPENCLI_DIAGNOSTIC=1 opencli weibo hot --limit 5 -f json 2>diag.json
# 2. Reads the diagnostic context
# 3. Fixes clis/weibo/hot.ts
# 4. Retries: opencli weibo hot --limit 5 -f json
# 5. Continues with the task
```
