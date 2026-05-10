# MDN Web Docs

**Mode**: 🌐 Public · **Domain**: `developer.mozilla.org`

Search the official Mozilla Developer Network web docs without auth or browser. One command.

## Commands

| Command | Description |
|---------|-------------|
| `opencli mdn search <query>` | Search MDN Web Docs by keyword |

## Usage Examples

```bash
# Web platform feature search
opencli mdn search fetch --limit 10
opencli mdn search flexbox --limit 5

# JS reference lookups
opencli mdn search "Array.prototype.map"

# Localized search (default: en-US)
opencli mdn search fetch --locale ja --limit 5
opencli mdn search fetch --locale zh-CN --limit 5

# JSON output
opencli mdn search fetch -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, title, slug, locale, summary, url` |

The `slug` column round-trips into MDN's URL space (`https://developer.mozilla.org/<locale>/docs/<slug>`).

## Options

| Option | Description |
|--------|-------------|
| `query` (positional) | Free-text query |
| `--limit` | Max results (1–50, default: 10) |
| `--locale` | Doc locale (default: `en-US`). Allowed: `en-US`, `de`, `es`, `fr`, `ja`, `ko`, `pt-BR`, `ru`, `zh-CN`, `zh-TW`. |

## Caveats

- Only the locales MDN actually publishes are accepted; passing anything else raises `ArgumentError`.
- The `summary` field is MDN's pre-computed search excerpt with whitespace collapsed; it is **not** the full document body.
- MDN throttles aggressive bursts; `HTTP 429` surfaces as a typed `CommandExecutionError` with a retry hint.

## Prerequisites

- No browser required — uses `developer.mozilla.org/api/v1/search`.
