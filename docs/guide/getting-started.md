# Getting Started

> **Make any website or Electron App your CLI.**
> Zero risk · Reuse Chrome login · AI-powered discovery · Browser + Desktop automation

[![npm](https://img.shields.io/npm/v/@jackwener/opencli?style=flat-square)](https://www.npmjs.com/package/@jackwener/opencli)
[![Node.js Version](https://img.shields.io/node/v/@jackwener/opencli?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/@jackwener/opencli?style=flat-square)](https://github.com/jackwener/opencli/blob/main/LICENSE)

OpenCLI turns **any website** or **Electron app** into a command-line interface — Bilibili, Zhihu, 小红书, Twitter/X, Reddit, YouTube, Antigravity, and [many more](/adapters/) — powered by browser session reuse and AI-native discovery.

## Highlights

- **CLI All Electron** — CLI-ify apps like Antigravity Ultra! Now AI can control itself natively.
- **Account-safe** — Reuses Chrome's logged-in state; your credentials never leave the browser.
- **AI Agent ready** — `explore` discovers APIs, `synthesize` generates adapters, `cascade` finds auth strategies.
- **Self-healing setup** — `opencli doctor` auto-starts the daemon and diagnoses extension + live browser connectivity.
- **Dynamic Loader** — Simply drop `.ts` or `.yaml` adapters into the `clis/` folder for auto-registration.
- **Dual-Engine Architecture** — Supports both YAML declarative data pipelines and robust browser runtime TypeScript injections.

## Quick Start

### Install via npm

```bash
npm install -g @jackwener/opencli
```

### Basic Usage

```bash
opencli list                              # See all commands
opencli hackernews top --limit 5          # Public API, no browser
opencli bilibili hot --limit 5            # Browser command
opencli zhihu hot -f json                 # JSON output
```

### Output Formats

All built-in commands support `--format` / `-f`:

```bash
opencli bilibili hot -f table   # Default: rich terminal table
opencli bilibili hot -f json    # JSON (pipe to jq or LLMs)
opencli bilibili hot -f yaml    # YAML (human-readable)
opencli bilibili hot -f md      # Markdown
opencli bilibili hot -f csv     # CSV
opencli bilibili hot -v         # Verbose: show pipeline debug
```

## Next Steps

- [Installation details](/guide/installation)
- [Browser Bridge setup](/guide/browser-bridge)
- [Plugins — extend with community adapters](/guide/plugins)
- [All available adapters](/adapters/)
- [For developers / AI agents](/developer/contributing)
- [Add a new Electron app CLI](/guide/electron-app-cli)
