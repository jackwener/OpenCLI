# OpenCLI

> **Make any website, Electron App, or Local Tool your CLI.**
> Zero risk · Reuse Chrome login · AI-powered discovery · Universal CLI Hub

[![中文文档](https://img.shields.io/badge/docs-%E4%B8%AD%E6%96%87-0F766E?style=flat-square)](./README.zh-CN.md)
[![npm](https://img.shields.io/npm/v/@jackwener/opencli?style=flat-square)](https://www.npmjs.com/package/@jackwener/opencli)
[![Node.js Version](https://img.shields.io/node/v/@jackwener/opencli?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/@jackwener/opencli?style=flat-square)](./LICENSE)

A CLI tool that turns **any website**, **Electron app**, or **local CLI tool** into a command-line interface — powered by browser session reuse and AI-native discovery.

- **Zero LLM cost** — No tokens consumed at runtime.
- **Account-safe** — Reuses Chrome's logged-in state; your credentials never leave the browser.
- **Deterministic** — Same command, same output schema, every time. Pipeable, scriptable, CI-friendly.
- **AI Agent ready** — `explore` discovers APIs, `synthesize` generates adapters, `cascade` finds auth strategies.
- **65+ built-in adapters** — Global and Chinese platforms, plus desktop Electron apps via CDP.

## Quick Start

```bash
npm install -g @jackwener/opencli
opencli doctor                         # Check setup
opencli list                           # See all commands
opencli hackernews top --limit 5       # Public API, no browser needed
opencli bilibili hot -f json           # Browser command, JSON output
```

**[→ Full documentation](./docs/index.md)**

## Documentation

| Topic | Link |
|-------|------|
| Installation & Setup | [docs/guide/installation.md](./docs/guide/installation.md) |
| Getting Started | [docs/guide/getting-started.md](./docs/guide/getting-started.md) |
| Built-in Commands | [docs/adapters/index.md](./docs/adapters/index.md) |
| Desktop App Adapters | [docs/adapters/desktop](./docs/adapters/desktop) |
| Plugins | [docs/guide/plugins.md](./docs/guide/plugins.md) |
| Electron App Guide | [docs/guide/electron-app-cli.md](./docs/guide/electron-app-cli.md) |
| Troubleshooting | [docs/guide/troubleshooting.md](./docs/guide/troubleshooting.md) |
| Comparison with other tools | [docs/comparison.md](./docs/comparison.md) |

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=jackwener/opencli&type=Date)](https://star-history.com/#jackwener/opencli&Date)

## License

[Apache-2.0](./LICENSE)
