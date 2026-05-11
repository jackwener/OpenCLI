# Self-Repair Protocol — Design Document

**Authors**: @opus0, @codex-mini0

**Date**: 2026-04-07

**Status**: Approved, updated for trace-based repair

**Supersedes**: `designs/autofix-incident-repair.md` (PR #863, deferred to Phase 2)

---

## Problem Statement

When an AI agent uses `opencli <site> <command>` and the command fails because the site changed DOM, API, or response schema, the agent should automatically repair the adapter and retry without human intervention or pre-written spec files.

From first principles, the agent needs five things:

1. The failing command it just ran.
2. The structured error envelope from stderr.
3. The adapter source path.
4. Browser runtime evidence: actions, page state, network, console, screenshot.
5. A verify oracle: re-run the same command.

The command itself is the spec. The trace artifact is the evidence channel.

---

## Design: Online Self-Repair

### Core Protocol

```text
Agent runs: opencli <site> <command> [args...]
  -> Command succeeds -> continue task
  -> Command fails ->
      1. Re-run with --trace retain-on-failure to collect a trace artifact
      2. Read trace.summaryPath from the error envelope
      3. Read adapterSourcePath from summary.md front matter
      4. Analyze: error code + failed network + console + state/action timeline -> root cause
      5. Edit the adapter file at adapterSourcePath
      6. Retry the original command
      7. If still failing -> repeat (max 3 rounds)
      8. If 3 rounds exhausted -> report failure, do not loop further
```

### Scope Constraint

Only modify the adapter file identified by `adapterSourcePath` in trace `summary.md` front matter.

That path may be:

- `clis/<site>/*.js` — repo-local adapters in a source checkout
- `~/.opencli/clis/<site>/*.js` — user-local adapters in npm install scenarios

The agent must use the trace summary path, not guess a repo-relative path. This matters for npm-installed users where `clis/` may not be in the working directory.

Never modify:

- `src/**` — core runtime
- `extension/**` — browser extension
- `autoresearch/**` — research infrastructure
- `tests/**` — test files
- `package.json`, `tsconfig.json` — project config

### When NOT to Self-Repair

| Signal | Meaning | Action |
|--------|---------|--------|
| Auth/login error | Not logged into site in Chrome | Tell user to log in, don't modify code |
| Browser bridge not connected | Extension/daemon not running | Tell user to run `opencli doctor` |
| CAPTCHA | Site requires human verification | Report, don't modify code |
| Rate limited / IP blocked | Not an adapter issue | Report, wait and retry later |
| Feature removed by site | Data no longer exists | Report, adapter may need deprecation |

### Retry Budget

- Max 3 repair rounds per command failure.
- Each round: trace -> edit adapter -> retry command.
- If the error is identical after a repair attempt, the fix didn't work. Try a different approach.
- After 3 rounds, stop and report what was tried.

---

## Implementation

| Component | Status | Location |
|-----------|--------|----------|
| Trace artifact output | Done | `src/observation/` |
| Error envelope trace metadata | Done | `src/errors.ts`, `src/execution.ts` |
| Adapter source resolution | Done | `src/adapter-source.ts` |
| AutoFix skill protocol | Done | `skills/opencli-autofix/SKILL.md` |

### Delivery Mechanism

The `opencli-autofix` skill is the portable self-repair protocol. Any AI agent can load this skill to get the workflow.

No separate diagnostic env var is required. The runtime has two control axes:

```text
-v / OPENCLI_VERBOSE              human-readable logs
--trace off|on|retain-on-failure  machine-readable browser evidence artifact
```

---

## The AutoFix Protocol

The `opencli-autofix` skill instructs agents:

1. When `opencli <site> <command>` fails, don't just report the error.
2. Re-run with `--trace retain-on-failure`.
3. Read the error envelope `trace.summaryPath`.
4. Parse `summary.md` front matter for `adapterSourcePath`.
5. Read and fix the adapter at that exact path.
6. Retry the original command.
7. If the retry passes, ask whether to file an upstream GitHub issue for `jackwener/OpenCLI`.
8. If approved and `gh` is available, file the issue using a structured summary.
9. Max 3 repair rounds, then stop.

---

## Relationship to PR #863

PR #863 (spec/runner/incident framework) is not needed for Phase 1. It becomes useful later as a hardening layer:

- Phase 1: self-repair via `opencli-autofix` skill and trace artifacts.
- Phase 2: high-frequency failures get hardened into command specs for offline regression testing and CI.

The spec/runner framework is the asset layer. It turns ad-hoc repairs into reusable tests, but it is not the entry point.

---

## Usage

No new commands. No new scripts. The agent loads the `opencli-autofix` skill and uses opencli normally:

```bash
# Agent runs a command as part of its task
opencli weibo hot --limit 5 -f json

# If it fails, the agent automatically:
# 1. Runs opencli weibo hot --limit 5 -f json --trace retain-on-failure 2>trace-error.yaml
# 2. Reads trace.summaryPath from trace-error.yaml
# 3. Reads adapterSourcePath from summary.md
# 4. Fixes the adapter at adapterSourcePath
# 5. Retries: opencli weibo hot --limit 5 -f json
# 6. If retry passes, asks whether to file an upstream issue
# 7. If approved, runs `gh issue create --repo jackwener/OpenCLI ...`
# 8. Continues with the task
```
