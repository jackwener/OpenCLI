# Jianyu

**Mode**: 🔐 Browser · **Domain**: `www.jianyu360.cn`

## Commands

| Command | Description |
|---------|-------------|
| `opencli jianyu search "<query>" --limit <n> [--since_days <n>]` | Search Jianyu bid notices and keep only accessible detail links |
| `opencli jianyu detail "<url>"` | Extract detail-page evidence blocks from a search URL |

## Usage Examples

```bash
# Search by keyword
opencli jianyu search "procurement" --limit 20 -f json

# Search another keyword with an explicit recency window
opencli jianyu search "substation" --limit 10 --since_days 30 -f json

# Extract structured detail evidence
opencli jianyu detail "https://www.jianyu360.cn/nologin/content/....html" -f json
```

## Prerequisites

- Chrome running with an active `jianyu360.cn` session
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `search` returns accessible procurement rows with `published_at`, `detail_status`, `project_code`, `budget_or_limit`, `url`, plus compatible `publish_time/date`.
- `search` keeps all reachable rows by default. `--since_days` enables an explicit recency filter.
- `detail` returns the same structured fields and adds `detail_text` + `evidence_blocks`.
- Date fields are normalized to `YYYY-MM-DD` when date text is detectable.
- Results are deduplicated by stable notice id when it is available.
- `--limit` defaults to `20` and is capped at `50`.

## Troubleshooting

- If the page shows login/verification prompts, complete it in Chrome and retry.
- If the command returns no valid rows due to noise/navigation pages, it reports taxonomy-style extraction errors instead of silent weak results.
