# Web of Science

**Mode**: 🔐 Browser · **Domain**: `webofscience.clarivate.cn`

## Commands

| Command | Description |
|---------|-------------|
| `opencli webofscience smart-search` | Search Web of Science records from `woscc` or `alldb` through Smart Search |
| `opencli webofscience basic-search` | Search Web of Science through the Basic Search page |
| `opencli webofscience author-search` | Search Web of Science researcher profiles |
| `opencli webofscience record` | Fetch a full record by UT, DOI, or full-record URL |

## Usage Examples

```bash
# Quick start
opencli webofscience smart-search "machine learning" --limit 5

# Search across all databases
opencli webofscience smart-search "machine learning" --database alldb --limit 5

# Use the basic-search entrypoint
opencli webofscience basic-search "graph neural networks" --database woscc

# Search researcher profiles
opencli webofscience author-search "Jane Doe"

# Fetch a full record by UT
opencli webofscience record WOS:001335131500001

# Fetch a full record by DOI from all databases
opencli webofscience record 10.1016/j.patter.2024.101046 --database alldb

# JSON output
opencli webofscience smart-search "graph neural networks" -f json

# Verbose mode
opencli webofscience smart-search "causal inference" -v
```

## Output Fields

- `rank`
- `title`
- `authors`
- `year`
- `source`
- `citations`
- `doi`
- `url`

`author-search` returns `rank`, `name`, `details`, and the author profile URL.

`record` returns `field` / `value` rows, including title, authors, abstract, UT, DOI, document type, publication/indexing metadata, corresponding address, author addresses, email addresses, research areas, Web of Science categories, citation counts, full-text link labels/URLs, and the full-record URL when available.

## Prerequisites

- Chrome running with access to your Web of Science institution/subscription
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- The adapter uses the Smart Search page, then replays the underlying `runQuerySearch` request for structured results.
- `basic-search` reuses the same structured search backend, but starts from the Basic Search page instead of Smart Search.
- `author-search` currently uses browser-driven page interaction and DOM extraction rather than a dedicated author API binding.
- `record` performs an exact search first to establish a query session, then requests `getFullRecordByQueryId` for the matching document.
- `record` also opens the full-record page to enrich the output with page-only fields such as full-text links and publication metadata that are not always present in the structured API payload.
- Web of Science may trigger passive verification before the first search. The adapter retries once automatically when the initial session is not ready.
