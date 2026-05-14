# Yahoo Search

**Mode**: 🌐 Public · **Domain**: `search.yahoo.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli yahoo search <keyword>` | Search Yahoo (powered by Bing) and extract results from the page |

## What works today

- Uses browser mode to search `search.yahoo.com` and extract ranked results via DOM queries.
- Supports `--page` for pagination. Yahoo returns approximately 7 results per page.
- Results include rank, title, URL, and snippet.
- `--limit` must be between 1 and 7; `--page` must be a positive integer.

## Current limitations

- Requires browser mode.
- Yahoo returns fewer results per page (7) compared to other engines.
- Page 2+ results may include lower-quality or less relevant matches.
- Yahoo wraps URLs in a `RU=.../RK=` redirect structure; the adapter automatically decodes them.

## Usage Examples

```bash
# Basic search
opencli yahoo search "machine learning"

# Limit results
opencli yahoo search "machine learning" --limit 5

# Pagination (second page)
opencli yahoo search "machine learning" --page 2

# JSON output
opencli yahoo search "machine learning" -f json
```

## Prerequisites

- Requires Chrome running (Standalone mode will auto-launch) or the [Browser Bridge extension](/guide/browser-bridge).

## Notes

- Yahoo Search is powered by Bing. Results are rendered server-side in the initial HTML.
- Yahoo uses `RU=` redirect URLs to wrap search results; the adapter extracts the real URLs automatically.
- Region/language filtering is not currently exposed as a parameter. Results depend on the browser session's locale.
