# YAML Adapter Guide

YAML adapters are the recommended way to add new commands when the site offers a straightforward API. They use a declarative pipeline approach — no TypeScript required.

Use YAML only when the command stays mostly declarative. If you find yourself embedding long JavaScript expressions, many fallbacks, or multi-step browser logic, move the command to a TypeScript adapter instead of growing an opaque template blob.

## Basic Structure

::: v-pre
```yaml
site: mysite          # Site identifier
name: trending        # Command name (opencli mysite trending)
description: ...      # Help text
domain: www.mysite.com
strategy: public      # public | cookie | header
browser: false        # true if browser session is needed

args:                 # CLI arguments
  limit:
    type: int
    default: 20
    description: Number of items

pipeline:             # Data processing steps
  - fetch:
      url: https://api.mysite.com/trending

  - map:
      rank: ${{ index + 1 }}
      title: ${{ item.title }}

  - limit: ${{ args.limit }}

columns: [rank, title, score, url]
```
:::

For most commands, keep the primary subject positional. Good examples:

- `opencli mysite search "rust"`
- `opencli mysite topic 123`
- `opencli mysite download "https://example.com/post/1"`

Prefer named flags only for optional modifiers such as `--limit`, `--sort`, `--lang`, or `--output`.

## Pipeline Steps

### `fetch`
Fetch data from a URL. Supports template expressions for dynamic URLs.

::: v-pre
```yaml
- fetch:
    url: https://api.example.com/search?q=${{ args.query }}
    headers:
      Accept: application/json
```
:::

### `map`

::: v-pre
Transform each item in the result array. Use `${{ item.xxx }}` for field access and `${{ index }}` for position.

```yaml
- map:
    rank: ${{ index + 1 }}
    title: ${{ item.title }}
    url: https://example.com${{ item.path }}
```
:::

### `limit`
Truncate results to N items.

::: v-pre
```yaml
- limit: ${{ args.limit }}
```
:::

### `filter`
Filter items by condition.

::: v-pre
```yaml
- filter: ${{ item.score > 100 }}
```
:::

### `download`
Download media files.

::: v-pre
```yaml
- download:
    url: ${{ item.imageUrl }}
    dir: ./downloads
    filename: ${{ item.title | sanitize }}.jpg
```
:::

### `stream-intercept`
Capture streaming responses (SSE / chunked transfer) incrementally. Unlike `intercept`, this reads the response body as a stream — ideal for AI chat endpoints that stream replies, and works in background tabs where DOM rendering is throttled. Requires `browser: true`.

::: v-pre
```yaml
- stream-intercept:
    capture: "StreamGenerate"
    trigger: "click:@send"
    timeout: 60
    waitForDone: true
```
:::

| Param | Default | Description |
|-------|---------|-------------|
| `capture` | (required) | URL substring to match |
| `trigger` | `""` | Action before capture: `click:@ref`, `navigate:url`, `evaluate:js`, `scroll` |
| `timeout` | `60` | Max seconds to wait for stream data |
| `waitForDone` | `true` | Wait until the stream completes (not just first bytes) |
| `returnEvents` | `false` | Return parsed SSE events instead of raw text |

## Template Expressions

::: v-pre
Use `${{ ... }}` for dynamic values:

| Expression | Description |
|-----------|-------------|
| `${{ args.limit }}` | CLI argument |
| `${{ item.title }}` | Current item field |
| `${{ index }}` | Current index (0-based) |
| `${{ item.x \| sanitize }}` | Pipe filters |
:::

## Real Example

See [`src/clis/hackernews/top.yaml`](https://github.com/jackwener/opencli/blob/main/src/clis/hackernews/top.yaml).

## Guardrails

- Add fallbacks for optional fields in `map` expressions when upstream payloads may be sparse.
- Keep template expressions short and readable. If the expression starts looking like a mini program, switch to TypeScript.
- If you add a new adapter, also add the matching doc page plus index/sidebar entries so `doc-coverage` stays green.
