# TypeScript Adapter Guide

Use TypeScript adapters when you need browser-side logic, multi-step flows, DOM manipulation, or complex data extraction that goes beyond simple API fetching.

## Basic Structure

```typescript
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

cli({
  site: 'mysite',
  name: 'search',
  description: 'Search MySite',
  access: 'read', // 'read' | 'write'
  example: 'opencli mysite search <query> -f yaml',
  domain: 'www.mysite.com',
  strategy: Strategy.COOKIE,      // PUBLIC | COOKIE | INTERCEPT | UI
  args: [
    { name: 'query', required: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 10, help: 'Max results' },
  ],
  columns: ['title', 'url', 'date'],

  func: async (page, kwargs) => {
    const { query, limit = 10 } = kwargs;

    // Navigate and extract data
    await page.goto('https://www.mysite.com');

    const data = await page.evaluate(async (q: string) => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        credentials: 'include',
      });
      return (await res.json()).results;
    }, String(query));

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

## Access Metadata

Every adapter must declare `access: 'read' | 'write'`.

- Use `read` when the command only retrieves data from the target product or account.
- Use `write` when the command changes remote product/account state, such as sending messages, publishing, liking, following, buying, deleting, creating remote assets, or starting paid/credit-consuming generation.
- `download` and `export` commands are `read` when they only read remote data and write local files; local filesystem writes are a separate permission dimension.

Adapters may also declare `example` to override the canonical invocation shown in agent-facing help. Prefer YAML examples, e.g. `opencli mysite search <query> -f yaml`.

## Listing↔Detail ID Pairing (advisory)

If your site exposes both a listing-class command (`search` / `hot` / `top` /
`recent` / ...) and a detail-class command (`read` / `paper` / `article` /
`post` / `view` / ...), it's usually nicer for agents if listing rows surface
an id-shaped column that round-trips into the detail command's positional
arg. Without that, an agent can't follow up on a row without re-searching by
title or scraping a URL out of band.

This is a **soft convention**, not a CI gate. Many legitimate listings
genuinely don't pair (topic-string trending, profile-attribute rows,
UI-only sessions). Use judgment per command, not a checklist.

Run `npm run advise:listing-id-pairing` to see candidate listings without an
id column. See [Listing↔Detail ID Pairing](../conventions/listing-detail-id-pairing.md)
for context, the full pattern table, and how to add an id to a listing.

## Strategy Types

| Strategy | Constant | Use Case |
|----------|----------|----------|
| Public | `Strategy.PUBLIC` | No auth needed |
| Cookie | `Strategy.COOKIE` | Browser session cookies |
| Intercept | `Strategy.INTERCEPT` | Capture browser requests/responses |
| UI | `Strategy.UI` | Drive authenticated browser UI |

## Browser Session Reuse

Browser-backed commands are one-shot by default: each execution gets a fresh
tab lease and releases it when the command returns. For interactive sites where
successive commands should continue in the same page, opt into a persistent site
session:

```typescript
cli({
  site: 'mysite',
  name: 'ask',
  strategy: Strategy.COOKIE,
  siteSession: 'persistent',
  // ...
});
```

`siteSession: 'persistent'` makes commands for the same site share a stable
adapter site tab and keeps that tab open until it is explicitly closed. Users
can override the adapter default with `--site-session ephemeral` or force
persistence with `--site-session persistent`.

## The `page` Object

The `page` parameter provides browser interaction methods:

- `page.goto(url)` — Navigate to a URL
- `page.evaluate(fn, ...args)` — Execute a serializable function in the page context. Pass Node-side values through JSON-serializable args; the function cannot close over local variables.
- `page.evaluate(script)` — Execute a raw JavaScript string in the page context. Prefer function form for new adapter code.
- `page.waitForSelector(selector)` — Wait for an element
- `page.click(selector)` — Click an element
- `page.type(selector, text)` — Type text into an input

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

Use the `opencli-adapter-author` skill plus the `opencli browser *` primitives to scaffold and verify adapters end-to-end:

```bash
# Recon on the target site
opencli browser open https://example.com
opencli browser network
opencli browser state

# Scaffold + verify
opencli browser init mysite/trending
opencli browser verify mysite/trending
```

See [AI Workflow](/developer/ai-workflow) for the full loop and the adapter-author skill for the step-by-step runbook.
