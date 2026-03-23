# Weibo (微博)

**Mode**: 🔐 Browser · **Domain**: `weibo.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli weibo hot` | |
| `opencli weibo search` | Search Weibo posts by keyword |

## Usage Examples

```bash
# Quick start
opencli weibo hot --limit 5

# JSON output
opencli weibo hot -f json

# Search
opencli weibo search "OpenAI" --limit 5

# Verbose mode
opencli weibo hot -v
```

## Prerequisites

- Chrome running and **logged into** weibo.com
- [Browser Bridge extension](/guide/browser-bridge) installed
