# Xiaohongshu (小红书)

**Mode**: 🔐 Browser · **Domain**: `xiaohongshu.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli xiaohongshu search` | Search notes by keyword (returns title, author, likes, URL) |
| `opencli xiaohongshu notifications` | |
| `opencli xiaohongshu feed` | |
| `opencli xiaohongshu user` | |
| `opencli xiaohongshu download` | |
| `opencli xiaohongshu creator-notes` | |
| `opencli xiaohongshu creator-note-detail` | |
| `opencli xiaohongshu creator-notes-summary` | |
| `opencli xiaohongshu creator-profile` | |
| `opencli xiaohongshu creator-stats` | |

## Usage Examples

```bash
# Search for notes
opencli xiaohongshu search 美食 --limit 10

# JSON output
opencli xiaohongshu search 旅行 -f json

# Other commands
opencli xiaohongshu feed
opencli xiaohongshu notifications
opencli xiaohongshu download <url>
```

## Prerequisites

- Chrome running and **logged into** xiaohongshu.com
- [Browser Bridge extension](/guide/browser-bridge) installed
