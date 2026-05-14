# Brave Search

**Mode**: 🌐 Public · **Domain**: `search.brave.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli brave search <keyword>` | Search Brave Search and extract results from the page |

## What works today

- Uses browser mode to search `search.brave.com` and extract ranked results via DOM queries.
- Supports `--offset` for GET-based pagination. Brave returns approximately 18 results per page.
- Results include rank, title, URL, and snippet.
- `--limit` must be between 1 and 18; `--offset` must be a non-negative page offset.

## Current limitations

- Requires browser mode. Brave Search does not offer a public, no-auth search API.
- DOM structure uses Svelte-generated class names that may change with updates.
- Some results may have empty snippets depending on Brave's layout.

## Usage Examples

```bash
# Basic search
opencli brave search "machine learning"

# Limit results
opencli brave search "machine learning" --limit 5

# Pagination (second page)
opencli brave search "machine learning" --offset 1

# JSON output
opencli brave search "machine learning" -f json
```

## Prerequisites

- Requires Chrome running (Standalone mode will auto-launch) or the [Browser Bridge extension](/guide/browser-bridge).

## Notes

- Brave Search renders results server-side; all results are present in the initial HTML (no lazy loading).
- Brave also shows an AI-generated summary box as the first result. The adapter filters this out via the `.standalone` class check.
