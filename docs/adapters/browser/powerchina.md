# PowerChina

**Mode**: 🔐 Browser · **Domain**: `bid.powerchina.cn`

## Commands

| Command | Description |
|---------|-------------|
| `opencli powerchina search "<query>" --limit <n>` | Search PowerChina procurement notices and return normalized result rows |

## Usage Examples

```bash
# Search by keyword
opencli powerchina search "procurement" --limit 20 -f json

# Search with another keyword
opencli powerchina search "substation" --limit 10 -f json
```

## Prerequisites

- Chrome running with an active `bid.powerchina.cn` session
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- This adapter probes multiple search entry URLs and returns merged rows.
- The `date` field is normalized to `YYYY-MM-DD` when date text is detectable.
- Results are deduplicated by `title + url`.
- `--limit` defaults to `20` and is capped at `50`.

## Troubleshooting

- If the site asks for login/verification, complete it in Chrome and retry.
- If results are empty, validate the same keyword directly on the website first.
