# Testing Guide

> The current testing reference for developers and AI agents.

## Test Structure

OpenCLI's tests currently fall into four categories:

| Category | Location | Current size | Primary purpose |
|---|---|---:|---|
| Unit tests | `src/**/*.test.ts` | 60 | Core runtime, command layer, browser bridge, output, plugins, and diagnostics |
| E2E tests | `tests/e2e/*.test.ts` | 11 | Real CLI entrypoints, public sites, browser commands, management commands, and output formats |
| Smoke tests | `tests/smoke/*.test.ts` | 1 | Health checks for external APIs and registration integrity |
| Step-level tests | `src/pipeline/steps/*.test.ts` | Included in unit tests | Pipeline-step behavior and edge cases |

There is no standalone `clis/**/*.test.{ts,js}` adapter-test tree in this repository. Adapter-related verification is primarily covered by:

- `tests/e2e/`
- `src/commanderAdapter.test.ts`
- `src/registry.test.ts`
- `src/execution.test.ts`
- `src/validate.ts` / `opencli validate`

## Default Local Strategy

Run the smallest sufficient set of checks locally before running the full suite.

Recommended order:

1. For command copy, output formats, or argument parsing changes:
   - Run the relevant unit tests.
   - Spot-check one real CLI command.
2. For adapter discovery, registration, or validation changes:
   - Run `src/registry.test.ts`.
   - Run `src/execution.test.ts`.
   - Run `opencli validate`.
3. For browser, daemon, or runtime changes:
   - Run the relevant `src/*test.ts` tests.
   - Add a `tests/e2e/*` test or manually verify with `opencli browser ...` when needed.
4. For shared low-level changes, changes spanning multiple modules, or higher confidence before merging:
   - Expand to `npm test`.

## Common Commands

```bash
# Type checking
npx tsc --noEmit

# Build artifacts
npm run build

# Run one target test file
npx vitest run src/<target>.test.ts

# All Vitest projects
npm run test:all

# E2E
npm run test:e2e

# Adapter registration / schema validation
node dist/src/main.js validate
```

To run the adapter project specifically, use:

```bash
npm run test:adapter
```

## Current E2E Files

`tests/e2e/` currently contains:

- `browser-auth.test.ts`
- `browser-public.test.ts`
- `cli.test.ts`
- `extension-bridge.test.ts`
- `formats.test.ts`
- `list.test.ts`
- `management.test.ts`
- `public-commands.test.ts`
- `recovery.test.ts`
- `remote-chrome.test.ts`
- `tab-targeting.test.ts`

If this list changes, treat the repository files as the source of truth:

```bash
find tests/e2e -name '*.test.ts' | sort
```

## Areas That Deserve Priority Coverage

Changes in the following areas are most likely to introduce regressions:

- `src/cli.ts`
- `src/commanderAdapter.ts`
- `src/discovery.ts`
- `src/execution.ts`
- `src/runtime.ts`
- `src/daemon.ts`
- `src/plugin.ts`
- `src/external.ts`
- `src/pipeline/**`

For these changes, prioritize:

- Focused unit tests
- One real CLI verification path
- Expanding to `npm test` when necessary

## Manual Verification Guidance

After documentation or command-surface changes, start with two to four real command spot checks, for example:

```bash
node dist/src/main.js --help
node dist/src/main.js list --format json
node dist/src/main.js plugin --help
node dist/src/main.js doctor --help
```

For browser-related changes, also run:

```bash
node dist/src/main.js browser --help
node dist/src/main.js browser tab list
```

## The Role of CI

CI provides broader regression confidence; local checks provide the fastest feedback loop.

Use CI for:

- Broader command-surface regression coverage
- Differences across environments
- E2E stability
- Smoke checks

Prioritize local checks for:

- Argument parsing
- Output formats
- Registration and discovery
- Documentation-related command behavior
- Small-scope regressions in shared modules

## When to Update This Document

Update this page whenever any of the following changes:

- The `tests/e2e/` file list
- Default local test commands
- Test scripts in `package.json`
- High-risk modules in the shared runtime
