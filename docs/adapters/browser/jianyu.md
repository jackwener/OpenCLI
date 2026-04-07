# Jianyu

**Mode**: 🔐 Browser · **Domain**: `www.jianyu360.cn`

## Commands

| Command | Description |
|---------|-------------|
| `opencli jianyu search "<query>" --limit <n>` | Search Jianyu bid notices and return normalized result rows |

## Usage Examples

```bash
# Search by keyword
opencli jianyu search "电梯" --limit 20 -f json

# Search another keyword with a smaller window
opencli jianyu search "施工升降机" --limit 10 -f json
```

## Prerequisites

- Chrome running with an active `jianyu360.cn` session
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- This adapter reads visible search result content only.
- The `date` field is normalized to `YYYY-MM-DD` when date text is detectable.
- Results are deduplicated by `title + url`.
- `--limit` defaults to `20` and is capped at `50`.

## Troubleshooting

- If the page shows login/verification prompts, complete it in Chrome and retry.
- If the command returns empty results, confirm the keyword and page availability on Jianyu UI first.
