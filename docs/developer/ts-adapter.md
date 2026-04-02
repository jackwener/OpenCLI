# TypeScript Adapter Guide

Use TypeScript adapters when you need browser-side logic, multi-step flows, DOM manipulation, or complex data extraction that goes beyond simple API fetching.

## Basic Structure

```typescript
import { cli, Strategy } from '../../registry.js';
import { CommandExecutionError, EmptyResultError } from '../../errors.js';

cli({
  site: 'mysite',
  name: 'search',
  description: 'Search MySite',
  domain: 'www.mysite.com',
  strategy: Strategy.COOKIE,      // PUBLIC | COOKIE | HEADER
  args: [
    { name: 'query', required: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 10, help: 'Max results' },
  ],
  columns: ['title', 'url', 'date'],

  func: async (page, kwargs) => {
    const { query, limit = 10 } = kwargs;

    // Navigate and extract data
    await page.goto('https://www.mysite.com');

    const data = await page.evaluate(`
      (async () => {
        const res = await fetch('/api/search?q=${encodeURIComponent(String(query))}', {
          credentials: 'include'
        });
        return (await res.json()).results;
      })()
    `);

    if (!Array.isArray(data)) throw new CommandExecutionError('MySite returned an unexpected response');
    if (!data.length) throw new EmptyResultError('mysite search', 'Try a different keyword');

    return data.slice(0, Number(limit)).map((item: any) => ({
      title: item.title,
      url: item.url,
      date: item.created_at,
    }));
  },
});
```

## Strategy Types

| Strategy | Constant | Use Case |
|----------|----------|----------|
| Public | `Strategy.PUBLIC` | No auth needed |
| Cookie | `Strategy.COOKIE` | Browser session cookies |
| Header | `Strategy.HEADER` | Custom headers/tokens |

## The `page` Object

The `page` parameter provides browser interaction methods:

- `page.goto(url)` — Navigate to a URL
- `page.evaluate(script)` — Execute JavaScript in the page context
- `page.waitForSelector(selector)` — Wait for an element
- `page.click(selector)` — Click an element
- `page.type(selector, text)` — Type text into an input

### Streaming API Interception

For capturing streaming responses (SSE / chunked transfer) — works in background tabs where DOM rendering is throttled but fetch streams and XHR progress events are not.

```typescript
await page.installStreamingInterceptor('StreamGenerate');
// ... trigger the streaming request ...
await page.waitForStreamCapture(60, { minChars: 100, waitForDone: true });
const { text, events, done, errors } = await page.getStreamedResponses();
// Or peek without clearing:
const { text } = await page.getStreamedResponses({ clear: false });
```

| Method | Description |
|--------|-------------|
| `installStreamingInterceptor(pattern)` | Patch fetch + XHR to capture streaming responses |
| `waitForStreamCapture(timeout, opts?)` | Poll until `minChars` reached and/or stream `done` |
| `getStreamedResponses(opts?)` | Read captured text/events; pass `{ clear: false }` to peek |

## The `kwargs` Object

Contains parsed CLI arguments as key-value pairs. Always destructure with defaults:

```typescript
const { query, limit = 10, format = 'json' } = kwargs;
```

For most search/read/detail commands, the main subject should be positional (`opencli mysite search "rust"`, `opencli mysite article 123`) instead of a named flag such as `--query` or `--id`. Keep named flags for optional modifiers.

## Error Handling

Prefer throwing `CliError` subclasses from `src/errors.ts` for expected adapter failures:

- `AuthRequiredError` for missing login / cookies
- `EmptyResultError` for empty but valid responses
- `CommandExecutionError` for unexpected API or browser failures
- `TimeoutError` for site timeouts
- `ArgumentError` for invalid user input

Avoid raw `Error` for normal adapter control flow. This keeps top-level CLI output consistent and preserves hints for users.

## AI-Assisted Development

Use the AI workflow tools to accelerate adapter creation:

```bash
# Discover APIs and page structure
opencli explore https://example.com --site mysite

# Auto-generate adapter from explore artifacts
opencli synthesize mysite

# One-shot: explore → synthesize → register
opencli generate https://example.com --goal "trending"
```

See [AI Workflow](/developer/ai-workflow) for the complete guide.
