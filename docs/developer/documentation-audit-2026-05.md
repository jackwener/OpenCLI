# Documentation Audit — 2026-05

This document reviews the current long-form docs, README surfaces, and developer guides in `opencli`. It focuses on stale facts, internal contradictions, and documentation structure that now causes drift.

## Scope

- `README.md`
- `README.zh-CN.md`
- `docs/`
- `skills/` references that are linked from user-facing docs

## Executive View

The docs are usable, but they are drifting in four visible ways:

1. **Hard-coded counts and feature claims are stale.**
2. **Developer docs describe an older architecture and older test layout.**
3. **English and Chinese docs are no longer updated with the same rigor.**
4. **Some pages still describe deleted concepts or old workflows.**

The highest-value work is:

1. Fix the stale facts in `README*`, `docs/index.md`, `docs/zh/index.md`, and `docs/guide/getting-started.md`.
2. Rewrite `docs/developer/testing.md` and `docs/developer/architecture.md` against current `main`.
3. Make English and Chinese entry docs derive from the same source-of-truth checklist.
4. Stop writing command/adapters counts by hand unless they are generated.

## Priority 0 — Clearly stale or incorrect

### 1. Adapter / site counts are stale across multiple entry points

Affected files:

- `README.md`
- `README.zh-CN.md`
- `docs/guide/getting-started.md`
- `docs/comparison.md`

Current problems:

- `README.md` and `README.zh-CN.md` still say `90+` adapters.
- `docs/guide/getting-started.md` still says `87+` pre-built adapters.
- `docs/comparison.md` still says `87+` sites.

Current reality:

- `node dist/src/main.js list --format json | jq 'map(.site) | unique | length'` returns `106`.

Why this matters:

- These are the first pages people read.
- The mismatch is easy to notice and weakens trust in the rest of the docs.
- These values will keep drifting if we maintain them manually.

Recommended fix:

- Replace all hard-coded counts with one of:
  - `100+`
  - `100+ sites`
  - `over 100 registered sites`
- Best option: generate this number into docs at release time or avoid explicit counts entirely.

### 2. `docs/developer/testing.md` is materially out of date

Affected file:

- `docs/developer/testing.md`

Current problems:

- It says adapter tests live in `clis/**/*.test.{ts,js}`.
- The file examples name adapter tests such as:
  - `clis/zhihu/download.test.ts`
  - `clis/twitter/timeline.test.ts`
  - `clis/reddit/read.test.ts`
  - `clis/bilibili/dynamic.test.ts`
- Those files do not exist.
- It says E2E coverage is `5` files.
- Current reality is `11` E2E files.
- It presents `npm test` as the main local gate, while current team rule is to prefer the smallest sufficient test set instead of default full-suite runs.

Current reality from the repo:

- `find src -name '*.test.ts' | wc -l` → `60`
- `find clis -iregex '.*\\.test\\.(ts|js)$' | wc -l` → `0`
- `find tests/e2e -name '*.test.ts' | wc -l` → `11`
- `find tests/smoke -name '*.test.ts' | wc -l` → `1`

Why this matters:

- This page is the main developer testing contract.
- A new contributor following it will get the wrong mental model of the test layout.
- It encourages a heavier default test habit than the team currently wants.

Recommended fix:

- Rewrite the page from current files, not from remembered structure.
- Separate:
  - `fast local checks`
  - `targeted validation`
  - `full CI coverage`
- Remove nonexistent adapter test examples.
- Add a short rule:
  - local default = smallest sufficient validation
  - full-suite = broader refactor, shared runtime changes, or CI

### 3. `docs/developer/architecture.md` describes an older system shape

Affected file:

- `docs/developer/architecture.md`

Current problems:

- It refers to `src/browser.ts`, but that file does not exist.
- The directory structure block says `src/clis/`, but adapters live at top-level `clis/`.
- The architecture diagram is too simplified for the current system and omits important pieces such as:
  - `daemon.ts`
  - `external.ts`
  - `plugin.ts`
  - `electron-apps.ts`
  - update check / diagnostics / runtime detection paths
- It says “3-tier authentication strategy” but lists `5` strategies.

Why this matters:

- This is the page people read to understand the project.
- Once architecture docs are stale, all deeper docs become harder to trust.

Recommended fix:

- Rewrite this page around current modules:
  - command discovery and registry
  - execution
  - browser / daemon bridge
  - external CLI integration
  - plugin system
  - desktop / CDP path
  - pipeline engine
- Replace the static tree with a curated module map that matches current filenames.
- Change “3-tier” to a neutral label like `authentication strategies`.

### 4. Home pages still mention deleted concepts

Affected files:

- `docs/index.md`
- `docs/zh/index.md`

Current problems:

- Both home pages say:
  - `explore`
  - `synthesize`
  - `cascade`
- `docs/developer/ai-workflow.md` explicitly says those commands do not exist and that the skill drives the loop.

Why this matters:

- The home page is currently teaching a product vocabulary that the actual CLI does not have.
- This creates immediate confusion for users who go from docs to terminal.

Recommended fix:

- Replace those phrases with current concepts:
  - `browser primitives`
  - `adapter-authoring skill`
  - `verify loop`
- Keep the homepage aligned with `docs/developer/ai-workflow.md`.

### 5. Chinese getting-started page lists a deleted built-in command

Affected file:

- `docs/zh/guide/getting-started.md`

Current problem:

- It says built-in commands include `list、explore、validate...`
- `explore` is not a current built-in command.

Why this matters:

- This is a hard user-facing error.

Recommended fix:

- Replace the example list with current built-ins such as:
  - `list`
  - `validate`
  - `verify`
  - `browser`
  - `doctor`
  - `plugin`
  - `adapter`

## Priority 1 — Inconsistent or incomplete

### 6. Installation pages are inconsistent about runtime support and update flow

Affected files:

- `README.md`
- `README.zh-CN.md`
- `docs/guide/installation.md`
- `docs/zh/guide/installation.md`

Current problems:

- `README.md` says Node `>= 21` or Bun `>= 1.0`.
- `docs/guide/installation.md` and `docs/zh/guide/installation.md` only mention Node.
- `README.md` documents skill refresh on update.
- `docs/zh/guide/installation.md` only documents package update and omits skills refresh.

Why this matters:

- Entry docs should agree on install prerequisites and upgrade procedure.

Recommended fix:

- Pick one official runtime support statement and reuse it everywhere.
- If Bun is supported, add it consistently to guide pages.
- Mirror the post-update skill refresh guidance in the install/update guides.

### 7. README and docs still use top-level tables and examples that will drift by hand

Affected files:

- `README.md`
- `README.zh-CN.md`

Current problems:

- The “Built-in Commands” section is manually curated and already partially selective.
- The surrounding copy still frames it like a broad current snapshot.

Why this matters:

- Manual command snapshots go stale quickly in a repo with active adapter growth.

Recommended fix:

- Reframe the section as:
  - “Representative built-in commands”
  - “Sample sites”
- Keep `opencli list` and `docs/adapters/index.md` as the full registry surface.

### 8. `docs/comparison.md` contains stale scale claims

Affected file:

- `docs/comparison.md`

Current problem:

- It still says `87+` sites.

Why this matters:

- Comparison pages shape market positioning.
- Stale numbers make the project look less maintained than it is.

Recommended fix:

- Remove exact numbers from comparison copy unless they are generated.

## Priority 2 — Structural drift risks

### 9. English and Chinese docs are drifting independently

Most visible examples:

- `docs/index.md` and `docs/zh/index.md` both kept the deleted `explore / synthesize / cascade` language.
- `docs/zh/guide/getting-started.md` contains a stale built-in command example that should have been caught by parity review.
- `README.md` and `README.zh-CN.md` both carry the same stale adapter count.

Why this keeps happening:

- We have mirrored content with no explicit parity checklist.
- Updates land in one place and rely on memory for the rest.

Recommended fix:

- Introduce a small doc parity checklist for any change that touches:
  - `README.md`
  - `README.zh-CN.md`
  - `docs/index.md`
  - `docs/zh/index.md`
  - `docs/guide/*`
  - `docs/zh/guide/*`
- Add one PR checklist item:
  - “Did this change require an English/Chinese mirror update?”

### 10. Core product pages mix generated facts with narrative copy

Examples:

- command counts
- site counts
- test counts
- lists of built-in commands

Why this matters:

- Numbers and command inventories drift faster than narrative guidance.

Recommended fix:

- For fast-changing facts:
  - generate them
  - or generalize them
- Reserve hand-written docs for:
  - mental models
  - workflows
  - constraints
  - trade-offs

## Suggested rewrite order

### Pass 1 — Fix trust-breaking errors

1. `README.md`
2. `README.zh-CN.md`
3. `docs/index.md`
4. `docs/zh/index.md`
5. `docs/guide/getting-started.md`
6. `docs/zh/guide/getting-started.md`
7. `docs/comparison.md`

### Pass 2 — Rebuild the technical source-of-truth pages

1. `docs/developer/testing.md`
2. `docs/developer/architecture.md`
3. `docs/guide/installation.md`
4. `docs/zh/guide/installation.md`

### Pass 3 — Prevent the next round of drift

1. Add a docs parity checklist to PR workflow.
2. Remove exact counts from hand-written copy unless generated.
3. Decide which pages are authoritative for:
   - install
   - browser bridge
   - testing
   - architecture
   - AI workflow

## Concrete edits I would make next

### Small fast edits

- Replace all `87+` / `90+` claims with `100+`.
- Remove `explore / synthesize / cascade` from both home pages.
- Remove `explore` from `docs/zh/guide/getting-started.md`.
- Align install docs on Node/Bun support and skill refresh.

### Medium rewrites

- Rewrite `docs/developer/testing.md` from current filesystem state.
- Rewrite `docs/developer/architecture.md` from current module boundaries.

### Process fix

- Add a lightweight “doc drift” checklist to PRs that touch command surface, runtime support, testing strategy, or adapter discovery.

## Bottom line

The docs do not need a ground-up rewrite. They need a focused trust repair pass on entry pages, then a source-of-truth rebuild for testing and architecture, then a small process change so counts and mirrored pages stop drifting.
