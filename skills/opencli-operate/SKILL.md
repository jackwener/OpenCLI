---
name: opencli-operate
description: Make websites accessible for AI agents. Navigate, click, type, extract, wait — using Chrome with existing login sessions. No LLM API key needed.
allowed-tools: Bash(opencli:*), Read, Edit, Write
---

# OpenCLI Operate — Browser Automation for AI Agents

Control Chrome step-by-step via CLI. Reuses existing login sessions — no passwords needed.

## Prerequisites

```bash
opencli doctor    # Verify extension + daemon connectivity
```

Requires: Chrome running + OpenCLI Browser Bridge extension installed.

## Critical Rules

1. **ALWAYS use `state` to inspect the page, NEVER use `screenshot`** — `state` returns structured DOM with `[N]` element indices, is instant and costs zero tokens. `screenshot` requires vision processing and is slow. Only use `screenshot` when the user explicitly asks to save a visual.
2. **ALWAYS use `click`/`type`/`select` for interaction, NEVER use `eval` to click or type** — `eval "el.click()"` bypasses scrollIntoView and CDP click pipeline, causing failures on off-screen elements. Use `state` to find the `[N]` index, then `click <N>`.
3. **Verify inputs with `get value`, not screenshots** — after `type`, run `get value <index>` to confirm.
4. **Run `state` after every page change** — after `open`, `click` (on links), `scroll`, always run `state` to see the new elements and their indices. Never guess indices.
5. **Chain safe commands with `&&`** — `type 3 "a" && type 4 "b" && click 7` is one call instead of three. But always run `state` first to get correct indices before chaining.
6. **`eval` is read-only** — use `eval` ONLY for data extraction (`JSON.stringify(...)`), never for clicking, typing, or navigating. Always wrap in IIFE to avoid variable conflicts: `eval "(function(){ const x = ...; return JSON.stringify(x); })()"`.
7. **Prefer `network` to discover APIs** — most sites have JSON APIs. API-based adapters are more reliable than DOM scraping.

## Command Cost Guide

| Cost | Commands | When to use |
|------|----------|-------------|
| **Free & instant** | `state`, `get *`, `eval`, `network`, `scroll`, `keys` | Default — use these |
| **Free but changes page** | `open`, `click`, `type`, `select`, `back` | Interaction — run `state` after |
| **Expensive (vision tokens)** | `screenshot` | ONLY when user needs a saved image |

## Action Chaining Rules

Commands can be chained with `&&`. The browser persists via daemon, so chaining is safe.

**Safe to chain** — these don't change the page structure:
```bash
# Fill multiple fields then submit
opencli operate type 3 "hello" && opencli operate type 4 "world" && opencli operate click 7

# Open and inspect
opencli operate open https://example.com && opencli operate state
```

**Page-changing — always put last** in a chain (subsequent commands see stale indices):
- `open <url>`, `back`, `click <link/button that navigates>`

**Rule**: Chain when you already know the indices. Run `state` separately when you need to discover indices first.

## Core Workflow

1. **Navigate**: `opencli operate open <url>`
2. **Inspect**: `opencli operate state` → elements with `[N]` indices
3. **Interact**: use indices — `click`, `type`, `select`, `keys`
4. **Wait** (if needed): `opencli operate wait selector ".loaded"` or `wait text "Success"`
5. **Verify**: `opencli operate state` or `opencli operate get value <N>`
6. **Repeat**: browser stays open between commands
7. **Save**: write a TS adapter to `~/.opencli/clis/<site>/<command>.ts`

## Commands

### Navigation

```bash
opencli operate open <url>              # Open URL (page-changing)
opencli operate back                    # Go back (page-changing)
opencli operate scroll down             # Scroll (up/down, --amount N)
opencli operate scroll up --amount 1000
```

### Inspect (free & instant)

```bash
opencli operate state                   # Structured DOM with [N] indices — PRIMARY tool
opencli operate screenshot [path.png]   # Save visual to file — ONLY for user deliverables
```

### Get (free & instant)

```bash
opencli operate get title               # Page title
opencli operate get url                 # Current URL
opencli operate get text <index>        # Element text content
opencli operate get value <index>       # Input/textarea value (use to verify after type)
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

### Extract (free & instant, read-only)

Use `eval` ONLY for reading data. Never use it to click, type, or navigate.

```bash
opencli operate eval "document.title"
opencli operate eval "JSON.stringify([...document.querySelectorAll('h2')].map(e => e.textContent))"

# IMPORTANT: wrap complex logic in IIFE to avoid "already declared" errors
opencli operate eval "(function(){ const items = [...document.querySelectorAll('.item')]; return JSON.stringify(items.map(e => e.textContent)); })()"
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
opencli operate type 3 "OpenCLI" && opencli operate type 4 "555-0100"
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

## Tips

1. **Always `state` first** — never guess element indices, always inspect first
2. **Sessions persist** — browser stays open between commands, no need to re-open
3. **Use `eval` for data extraction** — `eval "JSON.stringify(...)"` is faster than multiple `get` calls
4. **Use `network` to find APIs** — JSON APIs are more reliable than DOM scraping
5. **Alias**: `opencli op` is shorthand for `opencli operate`

## Troubleshooting

| Error | Fix |
|-------|-----|
| "Browser not connected" | Run `opencli doctor` |
| "attach failed: chrome-extension://" | Disable 1Password temporarily |
| Element not found | `opencli operate scroll down && opencli operate state` |
| Stale indices after page change | Run `opencli operate state` again to get fresh indices |
