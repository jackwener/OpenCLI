# Youdao Notes

**Mode**: 🌐 Public · **Domain**: `share.note.youdao.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli youdao note <url>` | Read a public shared Youdao Note |

## What works today

- Fetches publicly shared Youdao Notes by their share URL.
- Extracts title, full note body text, AI summary, keyword tags, creation time, file size, and canonical URL.
- Supports both `note.youdao.com` and `note.youdao.cn` URLs.

## Current limitations

- Requires browser mode. Youdao Notes renders content via React and loads it asynchronously.
- Notebook listing is not yet implemented.
- Attachment export is not implemented; only note metadata exposed by the shared page is returned.

## Usage Examples

```bash
# Read a shared note
opencli youdao note "https://share.note.youdao.com/ynoteshare/index.html?id=YOUR_NOTE_ID&type=note"

# JSON output
opencli youdao note "https://share.note.youdao.com/ynoteshare/index.html?id=YOUR_NOTE_ID&type=note" -f json
```

## Prerequisites

- Requires Chrome running (Standalone mode will auto-launch) or the [Browser Bridge extension](/guide/browser-bridge).

## Notes

- Share URLs must include the full path including the `id` parameter.
- The adapter waits up to 10 seconds for the page to fully render the note content.
- Youdao Notes uses React for client-side rendering. The adapter reads the rendered React store so parser drift fails explicitly instead of returning a summary-only row.
