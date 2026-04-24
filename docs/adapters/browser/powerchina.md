# PowerChina

**Mode**: 🔐 Browser · **Domain**: `bid.powerchina.cn`

## Commands

| Command | Description |
|---------|-------------|
| `opencli powerchina search "<query>" --limit <n>` | Search PowerChina procurement notices with API-first extraction and browser fallback |

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

- `search` prefers the structured announcement API and falls back to browser DOM extraction when the API is unavailable.
- Search results return V2 procurement fields (`content_type`, `publish_time`, `snippet`, `quality_flags`, etc.) and keep compatible `date/summary`.
- Results are deduplicated by `title + url`.
- `--limit` defaults to `20` and is capped at `50`.

## Troubleshooting

- If the site asks for login or human verification, complete it in Chrome and retry.
- If extraction only sees portal/navigation rows, the adapter returns taxonomy-style errors instead of weak candidates.
