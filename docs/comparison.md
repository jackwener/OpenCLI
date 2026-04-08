# Comparison Guide

OpenCLI occupies a specific niche in the browser automation ecosystem. This guide honestly evaluates where opencli excels, where it's a viable option, and where other tools are a better fit.

## At a Glance

| Tool | Approach | Best for |
|------|----------|----------|
| **opencli** | Pre-built TypeScript adapters | Deterministic site commands, broad platform coverage, desktop apps |
| **Browser-Use** | LLM-driven browser control | General-purpose AI browser automation |
| **Crawl4AI** | Async web crawler | Large-scale data crawling |
| **Firecrawl** | Scraping API / self-hosted | Clean markdown extraction, managed or self-hosted infrastructure |
| **agent-browser** | Browser primitive CLI | Token-efficient AI agent browsing |
| **Stagehand** | AI browser framework | Developer-friendly browser automation |
| **Skyvern** | Visual AI automation | Cross-site generalized workflows |

## Scenario Comparison

### 1. Scheduled Batch Data Extraction

> "I want to pull trending posts from Bilibili/Reddit/HackerNews every hour into my pipeline."

| Tool | Fit | Notes |
|------|-----|-------|
| **opencli** | Best | One command, structured JSON output, zero runtime cost. Runs in cron/CI without tokens or API keys. |
| Crawl4AI | Good | Strong for large-scale crawling, but requires writing extraction logic per site. |
| Firecrawl | Viable | Managed service with clean output, but costs scale with volume. |
| Browser-Use / Stagehand | Poor | LLM inference on every run is slow, expensive, and non-deterministic for repeated tasks. |

**Why opencli wins here:** A command like `opencli bilibili hot -f json` returns the same structured schema every time, costs nothing to run, and finishes in seconds. For recurring data extraction from known sites, pre-built adapters beat LLM-driven approaches on cost, speed, and reliability.

### 2. AI Agent Site Operations

> "My AI agent needs to search Twitter, read Reddit threads, or post to Xiaohongshu."

| Tool | Fit | Notes |
|------|-----|-------|
| **opencli** | Best | Structured JSON output, fast deterministic execution, hundreds of commands ready to use. |
| agent-browser | Good | Token-efficient browser primitives, but requires LLM reasoning for every step. |
| Browser-Use | Viable | General-purpose, but each operation costs tokens and takes 10-60s. |
| Stagehand | Viable | Good DX, but same LLM-per-action cost model. |

**Why opencli wins here:** When your agent needs `twitter search "AI news" -f json`, a deterministic command that returns in seconds is strictly better than an LLM clicking through a webpage. The agent saves tokens for reasoning, not navigation.

### 3. Authenticated Operations (Login-Required Sites)

> "I need to access my bookmarks, post content, or interact with sites that require login."

| Tool | Fit | Notes |
|------|-----|-------|
| **opencli** | Best | Reuses your Chrome login session via Browser Bridge. No credentials stored or transmitted. |
| Browser-Use | Viable | Can use browser profiles, but credential management is manual. |
| Firecrawl | Poor | Cloud service cannot access your authenticated sessions. |
| Crawl4AI | Poor | Requires manual cookie/session injection. |

**Why opencli wins here:** The Browser Bridge extension reuses your existing Chrome login state in real-time. You log in once in Chrome, and opencli commands work immediately. No OAuth setup, no API keys, no credential files.

### 4. General Web Browsing & Exploration

> "I need to explore an unknown website, fill forms, or navigate complex multi-step flows."

| Tool | Fit | Notes |
|------|-----|-------|
| Browser-Use | Best | LLM-driven, handles arbitrary websites and flows. |
| Stagehand | Best | Clean API for `act()`, `extract()`, `observe()` on any page. |
| agent-browser | Good | Token-efficient primitives for AI agents. |
| Skyvern | Good | Visual AI that generalizes across sites. |
| **opencli** | Poor | Only works with sites that have pre-built adapters. Cannot handle arbitrary websites. |

**opencli is not the right tool here.** If you need to explore unknown websites or handle one-off tasks on sites without adapters, use an LLM-driven browser tool. opencli trades generality for determinism and cost.

### 5. Desktop App Control

> "I want to script Cursor, ChatGPT, Notion, or other Electron apps from the terminal."

| Tool | Fit | Notes |
|------|-----|-------|
| **opencli** | Best | 8 desktop adapters via CDP + AppleScript. The only CLI tool with this capability. |
| All others | N/A | Browser automation tools cannot control desktop applications. |

**This is unique to opencli.** No other tool in this comparison can send a prompt to ChatGPT desktop, extract code from Cursor, or write to Notion pages via CLI.

## Key Trade-offs

### opencli's Strengths

- **Zero LLM cost** — No tokens consumed at runtime. Run 10,000 times for free.
- **Deterministic output** — Same command always returns the same schema. Pipeable, scriptable, CI-friendly.
- **Speed** — Adapter commands return in seconds, not minutes.
- **Broad platform coverage** — 73+ sites spanning global platforms (Reddit, HackerNews, Twitter, YouTube) and Chinese platforms (Bilibili, Zhihu, Xiaohongshu, Douban, Weibo) with adapters that understand local anti-bot patterns.
- **Desktop app control** — CDP adapters for Cursor, Codex, Notion, ChatGPT, Discord, and more.
- **Easy to extend** — Drop a `.ts` adapter into the `clis/` folder for auto-registration. Contributing a new site adapter is straightforward.

### opencli's Limitations

- **Coverage requires adapters** — opencli only works with sites that have pre-built adapters. Adding a new site means writing a TypeScript adapter.
- **Adapter maintenance** — When a website updates its DOM or API, the corresponding adapter may need updating. The community maintains these, but breakage is possible.
- **Not general-purpose** — Cannot handle arbitrary websites. For unknown sites, pair opencli with a general browser tool as a fallback.

## Complementary Usage

opencli works best alongside general-purpose browser tools, not as a replacement:

```
Has adapter?  ──yes──▶  opencli (fast, free, deterministic)
     │
     no
     │
     ▼
One-off task?  ──yes──▶  Browser-Use / Stagehand (LLM-driven)
     │
     no
     │
     ▼
Recurring?    ──yes──▶  Write an opencli adapter, then use opencli
```

## Further Reading

- [Architecture Overview](./developer/architecture.md)
- [Writing a TypeScript Adapter](./developer/ts-adapter.md)
- [Testing Guide](./developer/testing.md)
- [AI Workflow](./developer/ai-workflow.md)
- [Contributing Guide](./developer/contributing.md)
