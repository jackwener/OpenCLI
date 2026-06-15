# Threads Login-State Search Adapter — Design Plan

**Date**: 2026-05-11

**Status**: Proposed

**Target command**: `opencli threads search`

---

## Problem Statement

The user wants OpenCLI agents to search Meta Threads content without using the official Threads API Keyword Search permission. The adapter should use the user's existing Threads login state in Chrome and return structured search results that an agent can consume.

This is not a replacement for the official API. It is a browser-backed adapter for data that the logged-in user can already view in the Threads web UI.

As of this plan, the primary web domain should be treated as `www.threads.com`. Legacy `threads.net` URLs may redirect and should be observed during recon, but new adapter code should start from the current web domain unless live evidence says otherwise.

## Goals

1. Search Threads posts by keyword using the user's logged-in Chrome session.
2. Return normalized rows with stable columns: author, text, timestamp, URL, and engagement metadata when available.
3. Prefer HTTP/JSON data captured from the Threads web app over brittle DOM scraping.
4. Keep the first implementation narrow enough to verify and repair when Threads changes.
5. Avoid bypassing permissions, scraping private content, or building high-volume crawling behavior.

## Non-Goals

- Do not use `https://graph.threads.net/keyword_search`.
- Do not require a Meta developer app or `threads_keyword_search` permission.
- Do not search content unavailable to the logged-in user in the normal Threads UI.
- Do not implement large-scale pagination or historical archive collection in the first version.
- Do not mix profile search and post search in one command unless the web endpoint naturally returns both and fields are clearly separated.

## User-Facing Command

First version:

```bash
opencli threads search "openai" --limit 20 -f json
```

Likely options:

| Arg | Type | Default | Notes |
|-----|------|---------|-------|
| `query` | positional string | required | Search keyword entered in Threads search UI |
| `limit` | int | `20` | Clamp to a conservative maximum, probably `50` |
| `tab` | string | `top` | Optional if Threads exposes `top` / `recent` / similar tabs |
| `cursor` | string | none | Only add after the first endpoint is understood |
| `raw` | boolean | `false` | Optional debugging escape hatch for field discovery |

Output columns:

| Column | Meaning |
|--------|---------|
| `rank` | 1-based rank in returned result order |
| `username` | Threads username / handle |
| `displayName` | Display name if available |
| `text` | Post text, trimmed |
| `timestamp` | ISO timestamp if available; otherwise relative UI time only as fallback |
| `url` | Threads post permalink |
| `replyCount` | Replies, nullable |
| `repostCount` | Reposts, nullable |
| `likeCount` | Likes, nullable |
| `isReply` | Boolean or nullable |
| `isQuote` | Boolean or nullable |

Minimum acceptable first version columns:

```text
rank, username, text, timestamp, url
```

The adapter should not invent counts. If the internal response does not expose a metric reliably, return `null` or omit that column from the first version.

## Adapter Strategy

Use `Strategy.INTERCEPT` if the search endpoint requires dynamic request headers or internal tokens that are easiest to capture from the live web app.

Use `Strategy.COOKIE` only if recon proves the endpoint can be called from `page.evaluate()` with ordinary session cookies and stable headers.

Use `Strategy.UI` only as a fallback if the site does not expose a reusable JSON/XHR response. UI scraping should be the last resort because Threads can change DOM structure frequently.

Recommended first implementation:

```js
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'threads',
  name: 'search',
  access: 'read',
  description: 'Search Threads posts using the logged-in browser session',
  domain: 'www.threads.com',
  strategy: Strategy.INTERCEPT,
  browser: true,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search keyword' },
    { name: 'limit', type: 'int', default: 20, help: 'Max results' },
  ],
  columns: ['rank', 'username', 'displayName', 'text', 'timestamp', 'url', 'replyCount', 'repostCount', 'likeCount'],
  func: async (page, args) => {
    // Implementation depends on recon output.
  },
});
```

## Discovery Plan

Follow the `opencli-adapter-author` workflow. Do not guess internal Threads endpoints.

### 1. Validate Browser Bridge

```bash
opencli doctor
```

Required outcome:

- Daemon is running.
- Chrome extension is connected.
- Browser commands can open and inspect pages.

If doctor fails, fix browser bridge first. This is not an adapter problem.

### 2. Confirm Login State

Open Threads in the browser-backed workspace:

```bash
opencli browser open https://www.threads.com/
opencli browser state -f json
```

Required outcome:

- Page shows logged-in Threads UI.
- No login wall, checkpoint, CAPTCHA, or "try again later" page.

If login is missing, the user must log in through Chrome manually. The adapter should not automate login.

### 3. Recon Search UI

Run a manual search in a live browser session:

```bash
opencli browser open "https://www.threads.com/search?q=openai"
opencli browser state -f json
opencli browser network --detail -f json
```

If URL search parameters do not trigger results, drive the UI:

```bash
opencli browser find "Search"
opencli browser type <selector-ref> "openai"
opencli browser network --detail -f json
```

Inspect network requests and identify:

- Search endpoint URL.
- HTTP method.
- Required query/body parameters.
- Required request headers.
- Whether the response is JSON, GraphQL JSON, Relay payload, or streamed chunks.
- Pagination cursor, if present.
- Response fields for post text, author, permalink, timestamp, and counts.

### 4. Endpoint Verification

Before writing the adapter, call the candidate endpoint from the browser context with the exact observed parameters.

Success criteria:

- HTTP status is 200.
- Response contains search results.
- At least one result can be matched visually against the Threads UI.
- A second keyword also returns plausible results.

Failure handling:

| Failure | Meaning | Next Step |
|---------|---------|-----------|
| 401 / 403 | Missing cookie, token, or header | Compare captured request headers and cookies |
| HTML response | Wrong endpoint or navigation page | Return to network discovery |
| Empty results for obvious query | Missing parameter, wrong tab, or wrong query encoding | Compare with live search request |
| CAPTCHA / checkpoint | Human verification required | Stop; do not code around it |
| Rate limit | Site-side throttling | Stop and retry later |

### 5. Field Decode

Decode fields against visible UI values. For one known search result, verify:

- `username` matches the visible handle.
- `text` matches the visible post content.
- `url` opens the same post.
- `timestamp` is either an absolute timestamp from JSON or a defensible conversion from response data.
- Counts match UI values, if counts are included.

Do not rely only on "non-empty result" verification. A wrong nested field can still produce plausible but incorrect output.

## Implementation Plan

### Phase 1: Private Adapter Prototype

Create a private adapter first:

```bash
opencli browser init threads/search
```

This should generate:

```text
~/.opencli/clis/threads/search.js
```

Build the first prototype there. This allows fast iteration without touching the public repo adapter list.

Prototype responsibilities:

1. Validate `query` is non-empty.
2. Validate `limit` is a bounded integer.
3. Navigate to Threads search UI or a neutral Threads page.
4. Trigger search or replay the discovered request.
5. Normalize result rows.
6. Throw typed errors for auth, empty results, timeout, and response shape failures.

### Phase 2: Stable Fetch Path

Prefer this control flow if the endpoint is replayable:

```text
page.goto("https://www.threads.com/")
  -> page.evaluate(fetch search endpoint with credentials: "include")
  -> parse JSON
  -> normalize rows
```

This is simpler than UI scraping and easier to test.

Use `Strategy.COOKIE` if this path is enough.

### Phase 3: Intercept Path

Use this if the endpoint requires dynamic headers or tokens:

```text
page.goto("https://www.threads.com/search")
  -> install network listener
  -> type query into search box
  -> wait for matching XHR/fetch request
  -> capture response body
  -> normalize rows
```

Use `Strategy.INTERCEPT` for this path.

The matching rule should be specific enough to avoid unrelated feed requests. Match by endpoint path plus request parameters, not only by host.

### Phase 4: UI Fallback

Use only if no usable response body is available.

Control flow:

```text
page.goto(search page)
  -> type query
  -> wait for visible result articles
  -> scroll until limit or timeout
  -> extract visible text, links, handles, timestamps
```

This version should return fewer columns:

```text
rank, username, text, timestamp, url
```

Do not include engagement counts unless they are reliably visible and parsable.

## Error Handling

Use typed errors where possible:

| Case | Error |
|------|-------|
| Empty query | `ArgumentError` |
| Invalid limit | `ArgumentError` |
| Not logged in | `AuthRequiredError` |
| No matching results | `EmptyResultError` |
| Search request never appears | `TimeoutError` or `CommandExecutionError` |
| Response shape changed | `CommandExecutionError` |
| CAPTCHA/checkpoint/rate limit | `CommandExecutionError` with clear user-facing message |

Avoid silent fallbacks:

- Do not return `[]` for auth failure.
- Do not return sentinel rows.
- Do not silently clamp bad user input without telling the user through validation.

## Verification Plan

### Local Validation

```bash
opencli validate threads/search
```

Expected:

- Command is registered.
- Columns match returned row keys.
- Args are valid.

### Browser Verification

Run with live trace during development:

```bash
opencli browser verify threads/search --trace on --live --focus
```

After first success, write a fixture:

```bash
opencli browser verify threads/search --write-fixture
```

Then tighten the fixture:

- Require non-empty `username`, `text`, and `url`.
- Require URL pattern matching Threads post permalinks.
- Require row count to be within a small expected range for a stable test keyword.
- Treat counts as nullable unless proven stable.

### Manual Cross-Check

For a known query:

1. Run adapter with `-f json`.
2. Open the first result URL in browser.
3. Confirm username, text, and timestamp match.
4. Confirm the visible result appears in Threads search UI.

This is required before moving from private adapter to public `clis/threads/search.js`.

## Site Memory

After verification, write local site memory:

```text
~/.opencli/sites/threads/endpoints.json
~/.opencli/sites/threads/field-map.json
~/.opencli/sites/threads/notes.md
~/.opencli/sites/threads/verify/search.json
~/.opencli/sites/threads/fixtures/search-<timestamp>.json
```

Rules:

- Strip cookies, auth headers, and account-specific private fields from fixtures.
- Record endpoint URL patterns, required params, response shape, and `verified_at`.
- Append notes rather than overwriting older discoveries.
- Store raw discovery dumps only under `~/.opencli/sites/threads/fixtures/` or `/tmp`.

## Public Repo Integration

Only after the private adapter is verified:

1. Copy implementation to `clis/threads/search.js`.
2. Add tests if helper functions are factored out.
3. Add `docs/adapters/browser/threads.md` with usage and prerequisites.
4. Run:

```bash
opencli validate threads/search
npm test
```

For a narrower local pass during iteration, use `npm run test:adapter`.

## Open Questions

1. Does Threads expose a direct search URL such as `/search?q=...`, or must the adapter drive the search box?
2. Are post search and profile search separate tabs/endpoints?
3. Does the internal response include stable absolute timestamps?
4. Are engagement counts present in the search response, or only on post detail pages?
5. Does pagination require a cursor from the response or repeated UI scrolling?
6. Does the endpoint host use `threads.com`, legacy `threads.net`, `instagram.com`, or a GraphQL relay domain?

These should be answered by live recon before implementation.

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Threads changes internal endpoint | Adapter breaks | Use trace-based repair and site memory |
| Login checkpoint appears | Command cannot run | Report auth issue, do not bypass |
| DOM changes | UI fallback breaks | Prefer network response path |
| Response fields are obfuscated | Field mapping can be wrong | Cross-check against visible UI |
| Rate limiting | Temporary failures | Keep conservative limits and no bulk crawling |
| Search personalization | Results differ across users | Document that results reflect logged-in account |

## Recommended First Cut

Implement the first cut as a private `Strategy.INTERCEPT` adapter with conservative output:

```text
rank, username, displayName, text, timestamp, url
```

Add engagement columns only after recon proves they are available in the same search response. Avoid post-detail fan-out in version 1 because that turns one search into many requests and increases rate-limit risk.

Once the endpoint and fields are stable across at least two queries, move the adapter into `clis/threads/search.js` and document it as a browser-login command.
