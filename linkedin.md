# LinkedIn

**Mode**: 🔐 Browser · **Domain**: `linkedin.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli linkedin search` | Search LinkedIn jobs (Voyager API), with optional `--details` enrichment |
| `opencli linkedin timeline` | Read posts from your LinkedIn home feed |

## Usage Examples

```bash
# Quick start
opencli linkedin search --limit 5

# Search with filters
opencli linkedin search "site reliability engineer" --location "San Francisco Bay Area" --remote remote

# Enrich with full description and apply URL (slower; 1 page navigation per row)
opencli linkedin search "data scientist" --limit 3 --details

# Read your home timeline
opencli linkedin timeline --limit 5

# JSON output
opencli linkedin search -f json
opencli linkedin timeline -f json
```

## Output

### `search`

Always returns: `rank` · `title` · `company` · `location` · `listed` · `salary` · `url`

When `--details` is set, each row additionally has:

| Column | Type | Notes |
|--------|------|-------|
| `description` | string \| null | Full "About the job" body. `null` if upstream had nothing or fetch failed (see `detail_error`). |
| `apply_url` | string \| null | First `apply`-labelled link on the page. `null` if upstream had nothing or fetch failed. |
| `detail_error` | string \| null | `null` on success. Otherwise short reason: `'no url'` (row had no jobId), `'fetch failed: <message>'` (navigation/parse threw), or `'missing description'` (page loaded but body was empty). |

Previously the adapter returned `description: '', apply_url: ''` for both the missing-url path and the silent-catch path — callers couldn't tell upstream gaps apart from fetch failures. The current shape preserves backward compatibility on success and surfaces failures with `null` + a typed reason on `detail_error`. Per-row failures still don't abort the batch.

`--limit` must be between 1 and 100, and `--start` must be a non-negative integer. LinkedIn login/auth walls abort with `AuthRequiredError` instead of being folded into `detail_error`.

## Prerequisites

- Chrome running and **logged into** linkedin.com
- [Browser Bridge extension](/guide/browser-bridge) installed
