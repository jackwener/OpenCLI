# Architecture

OpenCLI is built on a **Dual-Engine Architecture** with a unified command registry. Built-in adapters, plugins, and external CLI passthrough commands all register into the same command model, while using different execution backends.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                     opencli CLI                      │
│              (Commander.js entry point)               │
├─────────────────────────────────────────────────────┤
│                   Engine Layer                        │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │   Registry   │  │   Dynamic    │  │   Output   │ │
│  │  (commands)  │  │   Loader     │  │ Formatter  │ │
│  └──────────────┘  └──────────────┘  └────────────┘ │
├─────────────────────────────────────────────────────┤
│                 Adapter Layer                         │
│  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │  YAML Pipeline  │  │  TypeScript Adapters     │  │
│  │  (declarative)  │  │  (browser/desktop/AI)    │  │
│  └─────────────────┘  └──────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│              Connection Layer                         │
│  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │ Browser Bridge  │  │  CDP (Chrome DevTools)   │  │
│  │ (Extension+WS)  │  │  (Electron apps)         │  │
│  └─────────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Core Modules

### Registry (`src/registry.ts`)
Central command registry. Built-in adapters, plugins, and external CLI passthrough commands register here with shared metadata: site, name, description, strategy, args, execution backend, aliases, and optional binary metadata.

### Discovery (`src/discovery.ts`)
CLI discovery and manifest loading. Discovers commands from YAML and TypeScript adapter files, parses YAML pipelines, and registers them into the central registry.

### Execution (`src/execution.ts`)
Command execution: argument validation, lazy loading of adapter modules, and dispatching to the appropriate execution backend (`adapter` or `external-binary`).

### Commander Adapter (`src/commanderAdapter.ts`)
Bridges the Registry commands to Commander.js subcommands. Handles positional args, named options, browser session wiring, and output formatting. Isolates all Commander-specific logic so the core is framework-agnostic.

### Browser (`src/browser.ts`)
Manages connections to Chrome via the Browser Bridge WebSocket daemon. Handles JSON-RPC messaging, tab management, and extension/standalone mode switching.

### Pipeline (`src/pipeline/`)
The YAML pipeline engine. Processes declarative steps:
- **fetch** — HTTP requests with cookie/header strategies
- **map** — Data transformation with template expressions
- **limit** — Result truncation
- **filter** — Conditional filtering
- **download** — Media download support

### Output (`src/output.ts`)
Unified output formatting: `table`, `json`, `yaml`, `md`, `csv`.

## Authentication Strategies

OpenCLI uses a 3-tier authentication strategy:

| Strategy | How It Works | When to Use |
|----------|-------------|-------------|
| `public` | Direct HTTP fetch, no auth | Public APIs (HackerNews, BBC) |
| `cookie` | Reuse Chrome cookies via Browser Bridge | Logged-in sites (Bilibili, Zhihu) |
| `header` | Custom auth headers | API-key based services |
| `intercept` | Network request interception | GraphQL/XHR capture (Twitter) |
| `ui` | DOM interaction via accessibility snapshot | Desktop apps, write operations |

## Directory Structure

```
src/
├── main.ts              # Entry point
├── cli.ts               # Commander.js CLI setup + built-in commands
├── commanderAdapter.ts  # Registry → Commander bridge
├── discovery.ts         # CLI discovery, manifest loading, YAML parsing
├── execution.ts         # Arg validation, command execution
├── registry.ts          # Command registry
├── serialization.ts     # Command serialization helpers
├── runtime.ts           # Browser session & timeout management
├── browser/             # Browser Bridge connection
├── output.ts            # Output formatting
├── doctor.ts            # Diagnostic tool
├── pipeline/            # YAML pipeline engine
│   ├── runner.ts
│   ├── template.ts
│   ├── transform.ts
│   └── steps/
│       ├── fetch.ts
│       ├── map.ts
│       ├── limit.ts
│       ├── filter.ts
│       └── download.ts
└── clis/                # Site adapters
    ├── twitter/
    ├── reddit/
    ├── bilibili/
    ├── cursor/
    └── ...
```
