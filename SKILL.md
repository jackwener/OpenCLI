---
name: opencli
description: "OpenCLI — Make any website or Electron App your CLI. Zero risk, AI-powered, reuse Chrome login."
version: 1.5.6
author: jackwener
tags: [cli, browser, web, chrome-extension, cdp, AI, agent, operate]
---

# OpenCLI

> Make any website or Electron App your CLI. Reuse Chrome login, zero risk, AI-powered.

## Skills

OpenCLI has three specialized skills. Use the one that matches your task:

### 1. CLI Commands (`skills/cli/SKILL.md`)
Use existing CLI commands to fetch data, interact with websites and desktop apps.
```bash
opencli twitter trending --limit 10
opencli hackernews top --limit 5
opencli bilibili hot
```

### 2. Browser Automation (`skills/opencli-operate/SKILL.md`)
Make websites accessible for AI agents. Navigate, click, type, extract, wait — with existing Chrome login sessions. No LLM API key needed.
```bash
opencli operate open https://example.com
opencli operate state                    # See interactive elements with [N] indices
opencli operate click 3                  # Click element [3]
opencli operate network                  # Discover APIs
opencli operate init site/cmd            # Generate adapter scaffold
opencli operate verify site/cmd          # Test the adapter
```

### 3. Adapter Development (`skills/adapter-dev/SKILL.md`)
Create new CLI commands from websites. Explore APIs, record traffic, write TypeScript adapters.
```bash
opencli explore https://example.com
opencli record https://example.com
opencli generate https://example.com --goal "hot"
```

## Quick Setup

```bash
npm install -g @jackwener/opencli
opencli doctor    # Verify Chrome extension + daemon
```

## Configuration

```bash
# For AI agent (opencli operate)
export OPENCLI_PROVIDER=anthropic       # or openai
export OPENCLI_MODEL=sonnet             # model alias
export OPENCLI_API_KEY=sk-ant-...       # API key
export OPENCLI_BASE_URL=https://...     # optional proxy
```
