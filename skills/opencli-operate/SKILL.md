---
name: opencli-operate
description: Make websites accessible for AI agents. Navigate, click, type, extract, wait — using Chrome with existing login sessions. No LLM API key needed.
allowed-tools: Bash(opencli:*), Read, Edit, Write
---

# OpenCLI — Make Websites Accessible for AI Agents

Control Chrome step-by-step via CLI. Reuses existing login sessions — no passwords needed.

## Prerequisites

```bash
opencli doctor    # Verify extension + daemon connectivity
```

Requires: Chrome running + OpenCLI Browser Bridge extension installed.

## Quickstart for AI Agents (1 step)

Point your AI agent to this file. It contains everything needed to operate browsers.

## Quickstart for Humans (3 steps)

```bash
npm install -g @jackwener/opencli          # 1. Install
# Install extension from chrome://extensions  # 2. Load extension
opencli operate open https://example.com    # 3. Go!
```

## Core Workflow

1. **Navigate**: `opencli operate open <url>`
2. **Inspect**: `opencli operate state` → see elements with `[N]` indices
3. **Interact**: use indices — `click`, `type`, `select`, `keys`
4. **Wait**: `opencli operate wait selector ".loaded"` or `wait text "Success"`
5. **Verify**: `opencli operate get title` or `opencli operate screenshot`
6. **Repeat**: browser stays open between commands
7. **Save**: write a TS adapter to `~/.opencli/clis/<site>/<command>.ts`

## Commands

### Navigation

```bash
opencli operate open <url>              # Open URL
opencli operate back                    # Go back
opencli operate scroll down             # Scroll (up/down, --amount N)
opencli operate scroll up --amount 1000
```

### Inspect

```bash
opencli operate state                   # Elements with [N] indices
opencli operate screenshot [path.png]   # Screenshot
```

### Get (structured data)

```bash
opencli operate get title               # Page title
opencli operate get url                 # Current URL
opencli operate get text <index>        # Element text content
opencli operate get value <index>       # Input/textarea value
opencli operate get html                # Full page HTML
opencli operate get html --selector "h1" # Scoped HTML
opencli operate get attributes <index>  # Element attributes
```

### Interact

```bash
opencli operate click <index>           # Click element [N]
opencli operate type <index> "text"     # Type into element [N]
opencli operate select <index> "option" # Select dropdown
opencli operate keys "Enter"            # Press key (Enter, Escape, Tab, Control+a)
```

### Wait

```bash
opencli operate wait selector ".loaded"           # Wait for element
opencli operate wait selector ".spinner" --timeout 5000  # With timeout
opencli operate wait text "Success"               # Wait for text
opencli operate wait time 3                       # Wait N seconds
```

### Extract

```bash
opencli operate eval "document.title"
opencli operate eval "JSON.stringify([...document.querySelectorAll('h2')].map(e => e.textContent))"
```

### Network (API Discovery)

```bash
opencli operate network                  # Show captured API requests (auto-captured since open)
opencli operate network --detail 3       # Show full response body of request #3
opencli operate network --all            # Include static resources
```

### Sedimentation (Save as CLI)

```bash
opencli operate init hn/top              # Generate adapter scaffold
opencli operate verify hn/top            # Test the adapter
```

### Session

```bash
opencli operate close                   # Close automation window
```

## Example: Extract HN Stories

```bash
opencli operate open https://news.ycombinator.com
opencli operate state                   # See [1] a "Story 1", [2] a "Story 2"...
opencli operate eval "JSON.stringify([...document.querySelectorAll('.titleline a')].slice(0,5).map(a => ({title: a.textContent, url: a.href})))"
opencli operate close
```

## Example: Fill a Form

```bash
opencli operate open https://httpbin.org/forms/post
opencli operate state                   # See [3] input "Customer Name", [4] input "Telephone"
opencli operate type 3 "OpenCLI"
opencli operate type 4 "555-0100"
opencli operate get value 3             # Verify: "OpenCLI"
opencli operate close
```

## Saving as Reusable CLI — Complete Workflow

### Step-by-step sedimentation flow:

```bash
# 1. Explore the website
opencli operate open https://news.ycombinator.com
opencli operate state                          # Understand DOM structure

# 2. Discover APIs (crucial for high-quality adapters)
opencli operate eval "fetch('/api/...').then(r=>r.json())"   # Trigger API calls
opencli operate network                        # See captured API requests
opencli operate network --detail 0             # Inspect response body

# 3. Generate scaffold
opencli operate init hn/top                    # Creates ~/.opencli/clis/hn/top.ts

# 4. Edit the adapter (fill in func logic)
# - If API found: use fetch() directly (Strategy.PUBLIC or COOKIE)
# - If no API: use page.evaluate() for DOM extraction (Strategy.UI)

# 5. Verify
opencli operate verify hn/top                  # Runs the adapter and shows output

# 6. If verify fails, edit and retry
# 7. Close when done
opencli operate close
```

### Example adapter:

```typescript
// ~/.opencli/clis/hn/top.ts
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'hn',
  name: 'top',
  description: 'Top Hacker News stories',
  domain: 'news.ycombinator.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [{ name: 'limit', type: 'int', default: 5 }],
  columns: ['rank', 'title', 'score', 'url'],
  func: async (_page, kwargs) => {
    const limit = Math.min(Math.max(1, kwargs.limit ?? 5), 50);
    const resp = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    const ids = await resp.json();
    return Promise.all(
      ids.slice(0, limit).map(async (id: number, i: number) => {
        const item = await (await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)).json();
        return { rank: i + 1, title: item.title, score: item.score, url: item.url ?? '' };
      })
    );
  },
});
```

Save to `~/.opencli/clis/<site>/<command>.ts` → immediately available as `opencli <site> <command>`.

### Strategy Guide

| Strategy | When | browser: |
|----------|------|----------|
| `Strategy.PUBLIC` | Public API, no auth | `false` |
| `Strategy.COOKIE` | Needs login cookies | `true` |
| `Strategy.UI` | Direct DOM interaction | `true` |

**Always prefer API over UI** — if you discovered an API during browsing, use `fetch()` directly.

## Troubleshooting

| Error | Fix |
|-------|-----|
| "Browser not connected" | Run `opencli doctor` |
| "attach failed: chrome-extension://" | Disable 1Password temporarily |
| Element not found | `opencli operate scroll down` then `opencli operate state` |
