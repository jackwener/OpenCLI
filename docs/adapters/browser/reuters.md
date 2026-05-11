# Reuters

**Mode**: 🔐 Browser · **Domain**: `reuters.com`

The Reuters search API sits behind a Datadome anti-bot challenge for direct
fetches, so commands run inside a logged-in `www.reuters.com` tab via the
Browser Bridge.

## Commands

| Command | Description |
|---------|-------------|
| `opencli reuters search` | Search Reuters articles (`articles-by-search-v2` API) |
| `opencli reuters article-detail` | Fetch full article body + metadata for a Reuters URL |

## Usage Examples

```bash
# Search the latest Reuters articles
opencli reuters search "tariff" --limit 10

# Round-trip from search → detail using the `url` column
opencli reuters article-detail "https://www.reuters.com/world/..."

# JSON output
opencli reuters search "tariff" -f json
```

## Columns

`reuters search`:
`rank`, `title`, `date`, `section`, `section_path`, `authors`, `url`

`reuters article-detail`:
`title`, `date`, `section`, `section_path`, `authors`, `description`,
`word_count`, `url`, `body`

`--limit` accepts integers in `[1, 40]`. Out-of-range values raise
`ArgumentError` (no silent clamp).

## Prerequisites

- Chrome running with at least one tab on `www.reuters.com`
- Any Datadome / "verify you are human" prompt completed (the search API will
  return a non-JSON HTML page until the challenge is solved)
- [Browser Bridge extension](/guide/browser-bridge) installed

## Error Behaviour

| Condition | Error |
|-----------|-------|
| In-page `fetch()` threw | `CommandExecutionError` |
| HTTP 401/403 or Datadome/paywall/challenge page | `AuthRequiredError` |
| Other HTTP non-2xx / malformed body | `CommandExecutionError` |
| API returned `articles: []` | `EmptyResultError` |
| `--limit` out of `[1, 40]` | `ArgumentError` |
| `article-detail` URL not on `reuters.com` | `ArgumentError` |
| Article page rendered no body text | `EmptyResultError` |
