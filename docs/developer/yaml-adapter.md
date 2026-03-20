# YAML Adapter Guide

YAML adapters are the recommended way to add new commands when the site offers a straightforward API. They use a declarative pipeline approach — no TypeScript required.

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
