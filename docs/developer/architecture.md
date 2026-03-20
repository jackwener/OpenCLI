# Architecture

OpenCLI is built on a **Dual-Engine Architecture** that supports both declarative YAML pipelines and programmatic TypeScript adapters.

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
Central command registry. All adapters register their commands via the `cli()` function with metadata: site, name, description, domain, strategy, args, columns.

### Engine (`src/engine.ts`)
Command discovery and execution engine. Discovers commands from the registry, parses arguments, executes the appropriate adapter, and routes output through the formatter.

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

## Directory Structure

```
src/
├── main.ts              # Entry point
├── engine.ts            # Command execution engine
├── registry.ts          # Command registry
├── browser.ts           # Browser Bridge connection
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
