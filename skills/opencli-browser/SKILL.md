---
name: opencli-browser
description: Make websites accessible for AI agents. Navigate, click, type, extract, wait — using Chrome with existing login sessions. No LLM API key needed.
allowed-tools: Bash(opencli:*), Read, Edit, Write
---

# OpenCLI Browser — Browser Automation for AI Agents

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
5. **Chain commands aggressively with `&&`** — combine `open + state`, multiple `type` calls, and `type + get value` into single `&&` chains. Each tool call has overhead; chaining cuts it.
6. **`eval` is read-only** — use `eval` ONLY for data extraction (`JSON.stringify(...)`), never for clicking, typing, or navigating. Always wrap in IIFE to avoid variable conflicts: `eval "(function(){ const x = ...; return JSON.stringify(x); })()"`.
7. **Minimize total tool calls** — plan your sequence before acting. A good task completion uses 3-5 tool calls, not 15-20. Combine `open + state` as one call. Combine `type + type + click` as one call. Only run `state` separately when you need to discover new indices.
8. **Prefer `network` to discover APIs** — most sites have JSON APIs. API-based adapters are more reliable than DOM scraping.

## Command Cost Guide

| Cost | Commands | When to use |
|------|----------|-------------|
| **Free & instant** | `state`, `get *`, `eval`, `network`, `scroll`, `keys` | Default — use these |
| **Free but changes page** | `open`, `click`, `type`, `select`, `back` | Interaction — run `state` after |
| **Expensive (vision tokens)** | `screenshot` | ONLY when user needs a saved image |

## Action Chaining Rules

Commands can be chained with `&&`. The browser persists via daemon, so chaining is safe.

**Always chain when possible** — fewer tool calls = faster completion:
```bash
# GOOD: open + inspect in one call (saves 1 round trip)
opencli browser open https://example.com && opencli browser state

# GOOD: fill form in one call (saves 2 round trips)
opencli browser type 3 "hello" && opencli browser type 4 "world" && opencli browser click 7

# GOOD: type + verify in one call
opencli browser type 5 "test@example.com" && opencli browser get value 5

# GOOD: click + wait + state in one call (for page-changing clicks)
opencli browser click 12 && opencli browser wait time 1 && opencli browser state

# BAD: separate calls for each action (wasteful)
opencli browser type 3 "hello"    # Don't do this
opencli browser type 4 "world"    # when you can chain
opencli browser click 7            # all three together
```

**Page-changing — always put last** in a chain (subsequent commands see stale indices):
- `open <url>`, `back`, `click <link/button that navigates>`

**Rule**: Chain when you already know the indices. Run `state` separately when you need to discover indices first.

## Core Workflow

1. **Navigate**: `opencli browser open <url>`
2. **Inspect**: `opencli browser state` → elements with `[N]` indices
3. **Interact**: use indices — `click`, `type`, `select`, `keys`
4. **Wait** (if needed): `opencli browser wait selector ".loaded"` or `wait text "Success"`
5. **Verify**: `opencli browser state` or `opencli browser get value <N>`
6. **Repeat**: browser stays open between commands
7. **Save**: write a TS adapter to `~/.opencli/clis/<site>/<command>.ts`

## Commands

### Navigation

```bash
opencli browser open <url>              # Open URL (page-changing)
opencli browser back                    # Go back (page-changing)
opencli browser scroll down             # Scroll (up/down, --amount N)
opencli browser scroll up --amount 1000
```

### Inspect (free & instant)

```bash
opencli browser state                   # Structured DOM with [N] indices — PRIMARY tool
opencli browser screenshot [path.png]   # Save visual to file — ONLY for user deliverables
```

### Get (free & instant)

```bash
opencli browser get title               # Page title
opencli browser get url                 # Current URL
opencli browser get text <index>        # Element text content
opencli browser get value <index>       # Input/textarea value (use to verify after type)
opencli browser get html                # Full page HTML
opencli browser get html --selector "h1" # Scoped HTML
opencli browser get attributes <index>  # Element attributes
```

### Interact

```bash
opencli browser click <index>           # Click element [N]
opencli browser type <index> "text"     # Type into element [N]
opencli browser select <index> "option" # Select dropdown
opencli browser keys "Enter"            # Press key (Enter, Escape, Tab, Control+a)
```

### Wait

Three variants — use the right one for the situation:

```bash
opencli browser wait time 3                       # Wait N seconds (fixed delay)
opencli browser wait selector ".loaded"            # Wait until element appears in DOM
opencli browser wait selector ".spinner" --timeout 5000  # With timeout (default 30s)
opencli browser wait text "Success"                # Wait until text appears on page
```

**When to wait**: After `open` on SPAs, after `click` that triggers async loading, before `eval` on dynamically rendered content.

### Extract (free & instant, read-only)

Use `eval` ONLY for reading data. Never use it to click, type, or navigate.

```bash
opencli browser eval "document.title"
opencli browser eval "JSON.stringify([...document.querySelectorAll('h2')].map(e => e.textContent))"

# IMPORTANT: wrap complex logic in IIFE to avoid "already declared" errors
opencli browser eval "(function(){ const items = [...document.querySelectorAll('.item')]; return JSON.stringify(items.map(e => e.textContent)); })()"
```

**Selector safety**: Always use fallback selectors — `querySelector` returns `null` on miss:
```bash
# BAD: crashes if selector misses
opencli browser eval "document.querySelector('.title').textContent"

# GOOD: fallback with || or ?.
opencli browser eval "(document.querySelector('.title') || document.querySelector('h1') || {textContent:''}).textContent"
opencli browser eval "document.querySelector('.title')?.textContent ?? 'not found'"
```

### Network (API Discovery)

```bash
opencli browser network                  # Show captured API requests (auto-captured since open)
opencli browser network --detail 3       # Show full response body of request #3
opencli browser network --all            # Include static resources
```

### Sedimentation (Save as CLI)

```bash
opencli browser init hn/top              # Generate adapter scaffold at ~/.opencli/clis/hn/top.ts
opencli browser verify hn/top            # Test the adapter (adds --limit 3 only if `limit` arg is defined)
```

- `init` auto-detects the domain from the active browser session (no need to specify it)
- `init` creates the file + populates `site`, `name`, `domain`, and `columns` from current page
- `verify` runs the adapter end-to-end and prints output; if no `limit` arg exists in the adapter, it won't pass `--limit 3`

### Session

```bash
opencli browser close                   # Close automation window
```

## Example: Extract HN Stories

```bash
opencli browser open https://news.ycombinator.com
opencli browser state                   # See [1] a "Story 1", [2] a "Story 2"...
opencli browser eval "JSON.stringify([...document.querySelectorAll('.titleline a')].slice(0,5).map(a => ({title: a.textContent, url: a.href})))"
opencli browser close
```

## Example: Fill a Form

```bash
opencli browser open https://httpbin.org/forms/post
opencli browser state                   # See [3] input "Customer Name", [4] input "Telephone"
opencli browser type 3 "OpenCLI" && opencli browser type 4 "555-0100"
opencli browser get value 3             # Verify: "OpenCLI"
opencli browser close
```

## Saving as Reusable CLI — Complete Workflow

### Step-by-step sedimentation flow:

```bash
# 1. Explore the website
opencli browser open https://news.ycombinator.com
opencli browser state                          # Understand DOM structure

# 2. Discover APIs (crucial for high-quality adapters)
opencli browser eval "fetch('/api/...').then(r=>r.json())"   # Trigger API calls
opencli browser network                        # See captured API requests
opencli browser network --detail 0             # Inspect response body

# 3. Generate scaffold
opencli browser init hn/top                    # Creates ~/.opencli/clis/hn/top.ts

# 4. Edit the adapter (fill in func logic)
# - If API found: use fetch() directly (Strategy.PUBLIC or COOKIE)
# - If no API: use page.evaluate() for DOM extraction (Strategy.UI)

# 5. Verify
opencli browser verify hn/top                  # Runs the adapter and shows output

# 6. If verify fails, edit and retry
# 7. Close when done
opencli browser close
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
5. **Alias**: `opencli op` is shorthand for `opencli browser`

## Common Pitfalls

1. **`form.submit()` fails in automation** — Don't use `form.submit()` or `eval` to submit forms. Navigate directly to the search URL instead:
   ```bash
   # BAD: form.submit() often silently fails
   opencli browser eval "document.querySelector('form').submit()"
   # GOOD: construct the URL and navigate
   opencli browser open "https://github.com/search?q=opencli&type=repositories"
   ```

2. **GitHub DOM changes frequently** — Prefer `data-testid` attributes when available; they are more stable than class names or tag structure.

3. **SPA pages need `wait` before extraction** — After `open` or `click` on single-page apps, the DOM isn't ready immediately. Always `wait selector` or `wait text` before `eval`.

4. **Use `state` before clicking** — Run `opencli browser state` to inspect available interactive elements and their indices. Never guess indices from memory.

5. **`evaluate` runs in browser context** — `page.evaluate()` in adapters executes inside the browser. Node.js APIs (`fs`, `path`, `process`) are NOT available. Use `fetch()` for network calls, DOM APIs for page data.

6. **Backticks in `page.evaluate` break JSON storage** — When writing adapters that will be stored/transported as JSON, avoid template literals inside `page.evaluate`. Use string concatenation or function-style evaluate:
   ```typescript
   // BAD: template literal backticks break when adapter is in JSON
   page.evaluate(`document.querySelector("${selector}")`)
   // GOOD: function-style evaluate
   page.evaluate((sel) => document.querySelector(sel), selector)
   ```

## Troubleshooting

| Error | Fix |
|-------|-----|
| "Browser not connected" | Run `opencli doctor` |
| "attach failed: chrome-extension://" | Disable 1Password temporarily |
| Element not found | `opencli browser scroll down && opencli browser state` |
| Stale indices after page change | Run `opencli browser state` again to get fresh indices |
