# DuckDuckGo

**Mode**: 🌐 Public · **Domains**: `html.duckduckgo.com`, `duckduckgo.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli duckduckgo search <keyword>` | Search DuckDuckGo and extract results from the page |
| `opencli duckduckgo suggest <keyword>` | Get DuckDuckGo search suggestions |

## What works today

- `duckduckgo search` uses browser mode to search `html.duckduckgo.com` and extract ranked results.
- `duckduckgo suggest` uses the public JSON API at `duckduckgo.com/ac/` — no browser needed.
- `search` supports `--region` (e.g. `jp-jp`, `us-en`, `cn-zh`) and `--time` (`d`, `w`, `m`, `y`) filters.
- `search` supports `--offset` for pagination via XHR POST (avoids page navigation issues with `form.submit()`).

## Current limitations

- `duckduckgo search` requires browser mode due to anti-bot protections on DuckDuckGo.
- The HTML version returns a maximum of 10 results per page; `--limit` must be between 1 and 10.
- Pagination uses POST-based navigation; results may have some overlap at page boundaries.
- Snippet extraction is based on the HTML version's DOM structure (`.result__snippet`).

## Usage Examples

```bash
# Basic search
opencli duckduckgo search "machine learning"

# Limit results
opencli duckduckgo search "machine learning" --limit 5

# Region-specific search
opencli duckduckgo search "machine learning" --region jp-jp

# Time filter (past week)
opencli duckduckgo search "machine learning" --time w

# Pagination (second page)
opencli duckduckgo search "machine learning" --offset 10

# JSON output
opencli duckduckgo search "machine learning" -f json

# Search suggestions
opencli duckduckgo suggest "machine" --limit 5
```

## Prerequisites

- `suggest` does not require Chrome.
- `search` requires Chrome running (Standalone mode will auto-launch) or the [Browser Bridge extension](/guide/browser-bridge).

## Notes

- DuckDuckGo uses `uddg=` URL redirects; the adapter automatically decodes them to return clean URLs.
- The `ac/` suggest API returns phonetic suggestions for CJK queries, which may not always match expected results.
- Region codes follow DuckDuckGo's format (e.g. `jp-jp`, `us-en`, `uk-en`). Default is all regions.
