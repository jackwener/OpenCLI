# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
npm install                  # Install dependencies
npm run build                # tsc + copy-yaml + build-manifest
npm run dev                  # Run via tsx (no build needed)
npm start                    # Run built CLI from dist/
npm link                     # Global `opencli` command for testing
npx tsc --noEmit             # Type-check without emitting
```

## Test Commands

```bash
npm test                     # unit + extension + adapter projects
npm run test:adapter         # Adapter project only
npm run test:e2e             # E2E project (hits real APIs/browsers)
npm run test:all             # All projects including e2e + smoke

# Single test file
npm test -- --run clis/hackernews/hackernews.test.js
npx vitest run tests/e2e/management.test.ts

# Watch mode for development
npx vitest src/
```

Vitest projects: `unit` (src/**/*.test.ts), `extension` (extension/src/**/*.test.ts), `adapter` (clis/**/*.test.{ts,js}), `e2e` (tests/e2e/), `smoke` (tests/smoke/). Default `npm test` runs unit + extension + adapter only. Extended E2E browser tests require `OPENCLI_E2E=1`.

## Architecture Overview

OpenCLI turns websites, Electron apps, and local tools into CLI commands. The system has three main layers:

### 1. Registry & Adapter System (`src/registry.ts`, `clis/`)

Adapters define CLI commands via `cli()` from `@jackwener/opencli/registry`. Each adapter specifies a `site`, `name`, `strategy`, `args`, `columns`, and either a `pipeline` (declarative YAML-like) or `func` (imperative async function).

**Two adapter patterns:**

- **Pipeline adapters** (`browser: false`, strategy `PUBLIC`): Declarative chain of steps (`fetch`, `map`, `filter`, `limit`, etc.). No browser needed. See `clis/hackernews/top.js`.
- **func() adapters** (`browser: true`, strategies `COOKIE`/`HEADER`/`INTERCEPT`/`UI`): Imperative async function receiving an `IPage`. Uses logged-in browser session. See `clis/twitter/trending.js`.

**Strategy enum** determines auth: `PUBLIC` (no auth), `LOCAL` (local tool), `COOKIE` (reuse browser cookies), `HEADER` (inject headers), `INTERCEPT` (intercept network), `UI` (full browser automation).

Adapters live in `clis/<site>/<command>.js` (JS-first, loaded at runtime). The registry also supports user adapters at `~/.opencli/clis/` and plugins.

### 2. Pipeline Engine (`src/pipeline/`)

Declarative execution engine. Steps are registered in `src/pipeline/registry.ts` and executed sequentially by `executor.ts`. Each step receives `(page, params, data, args)` and returns new data state.

Core pipeline steps: `fetch`, `map`, `filter`, `sort`, `limit`, `select`, `navigate`, `click`, `type`, `fill`, `wait`, `press`, `snapshot`, `evaluate`, `intercept`, `tap`, `download`.

Pipeline steps that need a browser session are listed in `src/capabilityRouting.ts` (`BROWSER_ONLY_STEPS`). The `shouldUseBrowserSession()` function decides whether to spin up a browser for a given command.

### 3. Browser Layer (`src/browser/`)

Manages connections to Chrome/Chromium via CDP (Chrome DevTools Protocol). Key components:

- **Browser Bridge**: Chrome extension + local daemon (`src/browser/daemon-client.ts`) — connects to already-running Chrome with login sessions.
- **CDP** (`src/browser/cdp.ts`): Direct CDP connection for Electron apps or remote browsers.
- **Page abstraction** (`src/browser/page.ts`): `IPage` interface wrapping DOM operations (goto, evaluate, wait, click, etc.).
- **DOM snapshot** (`src/browser/dom-snapshot.ts`): Structured DOM extraction for AI agent consumption.

The `src/runtime.ts` module manages browser session lifecycle (attach, detach, timeout).

### Command Execution Flow

`main.ts` → Commander.js parses CLI args → `execution.ts` resolves the command from registry → validates args → opens browser session if needed → runs pipeline or func → formats output → exits with standard exit code.

### Extension (`extension/`)

Chrome extension (Manifest V3) with `background.ts` (native messaging to daemon) and `cdp.ts` (CDP bridge). Installed separately from the npm package.

## Key Exports (public API for plugins)

```typescript
import { cli, Strategy, onStartup, onBeforeExecute, onAfterExecute } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
```

## Adapter Conventions

- **Arg design**: Use `positional: true` for the primary required argument (query, symbol, id). Use named `--flag` for secondary/optional config (limit, format, sort).
- **Access**: `read` or `write` — write commands modify state (post, follow, delete).
- **File naming**: `kebab-case` for files, one command per file in `clis/<site>/`.
- **Errors**: Throw `AuthRequiredError` or `EmptyResultError` from `@jackwener/opencli/errors` for structured error handling.
- **Validation**: Run `opencli validate` to check all adapter definitions.

## Code Style

- TypeScript strict mode, ES Modules with `.js` extensions in imports
- `kebab-case` files, `camelCase` variables, `PascalCase` types
- Named exports only (no default exports)
- Conventional Commits: `feat(twitter): add thread command`

## GeoGebra Workflow

- `clis/geogebra/` has two intended modes:
  - Fresh automation page: `opencli geogebra ...`
  - Existing user tab: `opencli browser bind --workspace bound:geogebra --domain www.geogebra.org`, then `opencli geogebra ... --workspace bound:geogebra`
- Each `opencli geogebra ...` command runs in a fresh browser session unless `--workspace` is passed. Multi-step drawings must happen in one `eval` call, inside a purpose-built helper like `triangle`, or in a reused bound workspace.
- On the Geometry page, prefer constructions built from `Circle`, `Intersect`, and `Polygon`. Do not assume `RegularPolygon(...)` is available.
- In bound tabs, use distinctive labels like `OCLIA`, `OCLIB`, `OCLIC` to avoid clobbering the user's existing objects.
