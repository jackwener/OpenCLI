# BOSS Zhipin

**Mode**: 🔐 Browser · **Domain**: `zhipin.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli boss search` | Search jobs with optional filters and pagination |
| `opencli boss detail` | |

## Usage Examples

```bash
# Quick start
opencli boss search --limit 5

# Request a specific API page (15 jobs per BOSS page)
opencli boss search Python --city 深圳 --page 2 --limit 15

# JSON output
opencli boss search -f json

# Verbose mode
opencli boss search -v
```

## Prerequisites

- Chrome running and **logged into** zhipin.com
- [Browser Bridge extension](/guide/browser-bridge) installed

## Pagination

`--page` is sent as the `page` field in BOSS's
`/wapi/zpgeek/search/joblist.json` request. BOSS returns up to 15 jobs per
page. If `--limit` is greater than 15, search follows `hasMore` and requests
subsequent pages while preserving API order and removing repeated job IDs.

Authenticated live verification on 2026-11-22 confirmed two 15-row API pages,
30 unique rows for `--limit 30` in API order, and 15 rows for explicit `--page 2`.
The committed response fixture retains only synthetic identities and cropped rows.
