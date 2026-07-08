# Web

**Mode**: 🔐 Browser · **Domain**: any URL

## Commands

| Command | Description |
|---------|-------------|
| `opencli web read --url <url>` | Fetch any web page and export as Markdown |

## Usage Examples

```bash
# Read a web page and save as Markdown
opencli web read --url https://example.com/article

# Custom output directory
opencli web read --url https://example.com/article --output ./my-articles

# Skip image download
opencli web read --url https://example.com/article --download-images false

# JSON output
opencli web read --url https://example.com/article -f json

# Iframe/AJAX shell page: wait for rendered data and print diagnostics
opencli web read \
  --url https://example.com/shell.html \
  --wait-for "#gridDatas li" \
  --wait-until networkidle \
  --diagnose
```

## Render-Aware Reading

`web read` runs in Chrome, not in a raw HTTP fetcher. It now handles common shell pages where the top document only contains layout and the real content is rendered later.

| Option | Purpose |
|--------|---------|
| `--frames same-origin` | Default. Merge relevant accessible same-origin iframe bodies into the extracted HTML before Markdown conversion. |
| `--frames all-same-origin` | Exhaustive mode. Merge every accessible same-origin iframe when completeness matters more than Markdown noise. |
| `--frames none` | Disable iframe merging when the embedded content is noisy. |
| `--wait-for <selector>` | Wait until a CSS selector appears in the main document or a same-origin iframe before extraction. |
| `--wait-until networkidle` | Start network capture before navigation and wait until captured requests are quiet. |
| `--diagnose` | Print frame tree, empty table/list containers, and API-like XHR/fetch requests to stderr. |

Cross-origin iframes are listed in diagnostics but not merged. If diagnostics reveal that the page data comes from an API endpoint, prefer a dedicated adapter or `opencli browser network --detail <key>` for structured data instead of forcing table-like data into Markdown.

## Prerequisites

- Chrome running
- [Browser Bridge extension](/guide/browser-bridge) installed
