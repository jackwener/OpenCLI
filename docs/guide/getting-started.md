# Getting Started

> **Make any website or Electron App your CLI.**
> Zero risk · Reuse Chrome login · AI-powered discovery · Browser + Desktop automation

[![npm](https://img.shields.io/npm/v/@jackwener/opencli?style=flat-square)](https://www.npmjs.com/package/@jackwener/opencli)
[![Node.js Version](https://img.shields.io/node/v/@jackwener/opencli?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/@jackwener/opencli?style=flat-square)](https://github.com/jackwener/opencli/blob/main/LICENSE)

OpenCLI turns **any website** or **Electron app** into a command-line interface — Bilibili, Zhihu, 小红书, Twitter/X, Reddit, YouTube, Antigravity, and [many more](/adapters/) — powered by browser session reuse and AI-native discovery.

## Highlights

- **Desktop App Control** — Drive Electron apps (Cursor, Codex, ChatGPT, Notion, etc.) directly from the terminal via CDP.
- **Browser Automation** — `browser` gives AI agents direct browser control: click, type/fill, extract, screenshot — fully scriptable.
- **Website → CLI** — Turn any website into a deterministic CLI: 100+ site surfaces are already registered, or author your own with the `opencli-adapter-author` skill.
- **Account-safe** — Reuses Chrome's logged-in state; your credentials never leave the browser.
- **AI Agent ready** — `opencli browser *` primitives (`open` / `network` / `state` / `eval` / `init` / `verify`) drive the adapter-authoring loop.
- **Zero LLM cost** — No tokens consumed at runtime. Run 10,000 times and pay nothing.
- **Deterministic** — Same command, same output schema, every time. Pipeable, scriptable, CI-friendly.

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

### Tab Completion

OpenCLI supports intelligent tab completion to speed up command input:

```bash
# Add shell completion to your startup config
echo 'eval "$(opencli completion zsh)"' >> ~/.zshrc              # Zsh
echo 'eval "$(opencli completion bash)"' >> ~/.bashrc            # Bash
echo 'opencli completion fish | source' >> ~/.config/fish/config.fish  # Fish

# Restart your shell, then press Tab to complete:
opencli [Tab]          # Complete site names (bilibili, zhihu, twitter...)
opencli bilibili [Tab] # Complete commands (hot, search, me, download...)
```

The completion includes:
- All available sites and adapters
- Built-in commands (list, validate, verify, browser, doctor, plugin...)
- Command aliases
- Real-time updates as you add new adapters

## Next Steps

- [Installation details](/guide/installation)
- [Browser Bridge setup](/guide/browser-bridge)
- [Extending OpenCLI — custom commands, plugins, and external CLIs](/guide/extending-opencli)
- [Plugins — extend with community adapters](/guide/plugins)
- [All available adapters](/adapters/)
- [For developers / AI agents](/developer/contributing)
- [Add a new Electron app CLI](/guide/electron-app-cli)
