# Architecture

OpenCLI is a command surface that sits on top of four major subsystems:

1. command discovery and registry
2. execution and formatting
3. browser / daemon / CDP connectivity
4. adapter, plugin, and external CLI integration

## Runtime Shape

```text
opencli CLI
  ├─ command discovery / registry
  ├─ execution / output
  ├─ browser runtime
  │   ├─ Browser Bridge extension
  │   ├─ local daemon
  │   └─ direct CDP path
  ├─ adapter loading
  │   ├─ built-in site adapters
  │   ├─ generated adapters
  │   └─ pipeline-backed adapters
  ├─ plugin loading
  └─ external CLI passthrough
```

## Core Modules

### CLI Surface

- `src/main.ts` — process entrypoint
- `src/cli.ts` — top-level command tree and built-in command groups
- `src/completion.ts` / `src/completion-fast.ts` — shell completion

### Discovery, Registry, Execution

- `src/discovery.ts` — discovers built-in adapters, generated adapters, plugins, and manifests
- `src/registry.ts` — central command registry
- `src/registry-api.ts` — adapter-facing registration helpers
- `src/execution.ts` — argument validation, lazy loading, and command execution
- `src/commanderAdapter.ts` — bridges registry metadata into Commander subcommands
- `src/output.ts` — `table`, `json`, `yaml`, `md`, `csv` formatting
- `src/serialization.ts` — registry and manifest serialization helpers

### Browser and Runtime

- `src/runtime.ts` — shared command runtime and target resolution
- `src/daemon.ts` — lifecycle and bridge behavior for the local daemon
- `src/doctor.ts` — browser bridge diagnostics
- `src/diagnostic.ts` — structured failure context
- `src/interceptor.ts` — interception helpers for browser-backed strategies
- `src/browser/` — Browser Bridge connection and browser-side primitives

### Pipeline Engine

- `src/pipeline/executor.ts` — pipeline execution
- `src/pipeline/template.ts` — template expansion
- `src/pipeline/transform.ts` — transform helpers
- `src/pipeline/steps/` — concrete steps such as:
  - `fetch`
  - `download`
  - `browser`
  - `intercept`
  - `tap`
  - `transform`

### Adapter and Extension Surfaces

- `clis/` — built-in site adapters
- `src/plugin.ts` / `src/plugin-manifest.ts` / `src/plugin-scaffold.ts` — plugin install, metadata, scaffold
- `src/external.ts` / `src/external-clis.yaml` — external CLI passthrough and installable tools
- `src/electron-apps.ts` — desktop / Electron app support

## Command Sources

OpenCLI merges commands from multiple places into one registry:

| Source | Location | Examples |
|---|---|---|
| Built-in adapters | `clis/` | `twitter`, `bilibili`, `reddit`, `chatgpt-app` |
| Generated / local adapters | `~/.opencli/clis/` | user-authored adapters |
| Plugins | `~/.opencli/plugins/` | community-contributed commands |
| External CLIs | `src/external-clis.yaml` + local registrations | `gh`, `docker`, `vercel` |

The user sees one unified command tree through `opencli list`.

## Connectivity Modes

### Browser Bridge mode

Primary path for browser-backed commands:

```text
opencli process
  ↔ local daemon
  ↔ Browser Bridge extension
  ↔ logged-in Chrome / Chromium
```

This path is used for:

- cookie-backed websites
- browser automation primitives
- interactive browser verification

### Direct CDP mode

Used when OpenCLI talks directly to a Chrome or Electron debugging endpoint through `OPENCLI_CDP_ENDPOINT`.

Typical uses:

- remote Chrome
- headless Chrome
- Electron desktop adapters

## Authentication / Access Strategies

OpenCLI currently uses these access strategies:

| Strategy | Purpose |
|---|---|
| `public` | direct fetch with no login |
| `cookie` | reuse browser session cookies |
| `header` | custom authenticated headers |
| `intercept` | capture the app's own network responses |
| `ui` | DOM / accessibility driven interaction |

The key distinction is operational:

- `public`, `header` favor direct network access
- `cookie`, `intercept`, `ui` depend on a live browser or desktop surface

## High-Risk Change Zones

Changes in these files usually affect broad command behavior:

- `src/cli.ts`
- `src/commanderAdapter.ts`
- `src/discovery.ts`
- `src/execution.ts`
- `src/runtime.ts`
- `src/daemon.ts`
- `src/plugin.ts`
- `src/external.ts`
- `src/pipeline/**`

These areas deserve targeted tests first, then broader validation when the change crosses module boundaries.

## Mental Model

The simplest accurate model is:

1. OpenCLI discovers command definitions.
2. It registers them into one command registry.
3. It resolves each invocation through execution + runtime.
4. It reaches the target through one of:
   - network fetch
   - Browser Bridge
   - direct CDP
   - external CLI passthrough
5. It formats the result into a stable output surface.

That is the architecture to preserve when refactoring.
