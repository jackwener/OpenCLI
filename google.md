# Google

**Mode**: 🌐 / 🔐 Mixed · **Domains**: `google.com`, `suggestqueries.google.com`, `news.google.com`, `trends.google.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli google search <keyword>` | Search Google and extract results from the page |
| `opencli google suggest <keyword>` | Get Google search suggestions |
| `opencli google news [keyword]` | Get Google News headlines (top stories or search) |
| `opencli google trends` | Get Google Trends daily trending searches |

## What works today

- Public API commands work without a browser:
  - `suggest` — JSON API, no auth needed
  - `news` — RSS feed, supports top stories and keyword search
  - `trends` — RSS feed, supports different regions
- `google search` uses browser mode to extract results from google.com.

## Current limitations

- `google search` may trigger CAPTCHA in Standalone browser mode. Extension mode (with an established Chrome session) is more reliable.
- Google frequently changes its DOM structure. If `search` stops returning results, selectors may need updating.
- Snippet extraction may return empty for some results depending on Google's layout.

## Usage Examples

```bash
# Search Google
opencli google search "typescript tutorial" --limit 10

# Get search suggestions
opencli google suggest python

# Get top news headlines
opencli google news --limit 5

# Search news for a topic
opencli google news "artificial intelligence" --limit 10 --lang en --region US

# Get trending searches in Japan
opencli google trends --region JP --limit 10

# Output as JSON
opencli google search "machine learning" -f json
```

## Prerequisites

- `suggest`, `news`, `trends` do not require Chrome.
- `search` requires:
  - Chrome running (or Standalone mode will auto-launch)
  - For best results, use the [Browser Bridge extension](/guide/browser-bridge) with an established Google session

## Notes

- `suggest` defaults to `--lang zh-CN`; other commands default to `--lang en`.
- `news` supports `--lang` and `--region` parameters for localized results.
- `trends` traffic values are raw strings (e.g. "500K+", "1,000,000+"), not numeric.
- `search` output includes three result types: `result` (standard), `snippet` (featured answer box), and `paa` (People Also Ask).
