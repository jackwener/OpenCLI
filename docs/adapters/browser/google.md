# Google

**Mode**: 🌐 / 🔐 Mixed · **Domains**: `google.com`, `suggestqueries.google.com`, `news.google.com`, `trends.google.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli google images <keyword>` | Search Google Images and extract visible photo/image results |
| `opencli google news [keyword]` | Get Google News headlines (top stories or search) |
| `opencli google search <keyword>` | Search Google and extract results from the page |
| `opencli google suggest <keyword>` | Get Google search suggestions |
| `opencli google trends` | Get Google Trends daily trending searches |

## What works today

- Public API commands work without a browser:
  - `news` — RSS feed, supports top stories and keyword search
  - `suggest` — JSON API, no auth needed
  - `trends` — RSS feed, supports different regions
- `google search` uses browser mode to extract results from google.com.
- `google images` uses browser mode to extract visible Google Images results. By default it opens image previews and decodes Google's `imgurl` value so `imageUrl` is the original file URL when Google exposes it. Use `--resolve false` to skip preview clicks and return faster thumbnail-only rows.

## Current limitations

- `google search` may trigger CAPTCHA in Standalone browser mode. Extension mode (with an established Chrome session) is more reliable.
- `google images` uses the same browser-backed Google session as `search`, so it can hit the same CAPTCHA or consent-page limitations.
- Google frequently changes its DOM structure. If `search` stops returning results, selectors may need updating.
- Image result pages are especially dynamic; some rows may still expose only thumbnail URLs if Google does not load an `imgurl` value after the preview opens.
- Snippet extraction may return empty for some results depending on Google's layout.

## Usage Examples

```bash
# Search Google Images / photos
opencli google images "golden gate bridge at sunset" --limit 10

# Faster thumbnail-only image search
opencli google images "golden gate bridge at sunset" --limit 10 --resolve false

# Get top news headlines
opencli google news --limit 5

# Search news for a topic
opencli google news "artificial intelligence" --limit 10 --lang en --region US

# Search Google
opencli google search "typescript tutorial" --limit 10

# Get search suggestions
opencli google suggest python

# Output as JSON
opencli google search "machine learning" -f json

# Get trending searches in Japan
opencli google trends --region JP --limit 10
```

## Prerequisites

- `suggest`, `news`, `trends` do not require Chrome.
- `search` and `images` require:
  - Chrome running (or Standalone mode will auto-launch)
  - For best results, use the [Browser Bridge extension](/guide/browser-bridge) with an established Google session

## Notes

- `suggest` defaults to `--lang zh-CN`; other commands default to `--lang en`.
- `news` supports `--lang` and `--region` parameters for localized results.
- `trends` traffic values are raw strings (e.g. "500K+", "1,000,000+"), not numeric.
- `search` output includes three result types: `result` (standard), `snippet` (featured answer box), and `paa` (People Also Ask).
- `images` output includes `rank`, `title`, `imageUrl`, `thumbnailUrl`, `sourceUrl`, `source`, `width`, and `height`. With default preview resolution, `imageUrl` is the original image URL when Google provides one; otherwise it falls back to the visible thumbnail URL.
- `images --resolve false` skips preview clicks, so it is faster but more likely to return thumbnail URLs in `imageUrl`.
