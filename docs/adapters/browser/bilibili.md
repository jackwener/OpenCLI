# Bilibili

**Mode**: 🔐 Browser · **Domain**: `bilibili.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli bilibili hot` | |
| `opencli bilibili search` | |
| `opencli bilibili me` | |
| `opencli bilibili favorite` | |
| `opencli bilibili history` | |
| `opencli bilibili feed` | |
| `opencli bilibili feed-detail` | |
| `opencli bilibili subtitle` | |
| `opencli bilibili dynamic` | |
| `opencli bilibili ranking` | |
| `opencli bilibili following` | |
| `opencli bilibili user-videos` | |
| `opencli bilibili download` | |

## Usage Examples

```bash
# Quick start
opencli bilibili hot --limit 5

# Search videos
opencli bilibili search 黑神话 --limit 10

# Read one creator's videos
opencli bilibili user-videos 2 --limit 10

# Fetch subtitles
opencli bilibili subtitle BV1xx411c7mD --lang zh-CN

# JSON output
opencli bilibili hot -f json

# Verbose mode
opencli bilibili hot -v
```

## Prerequisites

- Chrome running and **logged into** bilibili.com
- [Browser Bridge extension](/guide/browser-bridge) installed
