# Xiaohongshu (小红书)

**Mode**: 🔐 Browser · **Domain**: `xiaohongshu.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli xiaohongshu search` | Search notes by keyword (returns title, author, likes, URL) |
| `opencli xiaohongshu note` | Read full note content (title, author, description, likes, collects, comments, tags) |
| `opencli xiaohongshu comments` | Read comments from a note (`--with-replies` for nested 楼中楼 replies) |
| `opencli xiaohongshu feed` | Home feed recommendations (via Pinia store interception) |
| `opencli xiaohongshu notifications` | User notifications (mentions, likes, connections) |
| `opencli xiaohongshu user` | Get public notes from a user profile |
| `opencli xiaohongshu download` | Download images and videos from a note |
| `opencli xiaohongshu publish` | Publish image-text notes (creator center UI automation) |
| `opencli xiaohongshu delete-note` | Verify or delete a published creator-center note by exact note ID |
| `opencli xiaohongshu creator-notes` | Creator's note list with per-note metrics |
| `opencli xiaohongshu creator-note-detail` | Detailed analytics for a single creator note |
| `opencli xiaohongshu creator-notes-summary` | Combined note list + detail analytics summary |
| `opencli xiaohongshu creator-profile` | Creator account info (followers, growth level) |
| `opencli xiaohongshu creator-stats` | Creator data overview (views, likes, collects, trends) |

## Usage Examples

```bash
# Search for notes
opencli xiaohongshu search 美食 --limit 10

# Read a note's full content (pass URL from search results to preserve xsec_token)
opencli xiaohongshu note "https://www.xiaohongshu.com/search_result/<id>?xsec_token=..."

# Read comments with nested replies (楼中楼)
opencli xiaohongshu comments "https://www.xiaohongshu.com/search_result/<id>?xsec_token=..." --with-replies --limit 20

# JSON output
opencli xiaohongshu search 旅行 -f json

# Other commands
opencli xiaohongshu feed
opencli xiaohongshu notifications
opencli xiaohongshu download "https://www.xiaohongshu.com/search_result/<id>?xsec_token=..."
opencli xiaohongshu download "https://xhslink.com/..."

# Verify a published creator note without deleting it (default dry-run)
opencli xiaohongshu delete-note 6a08ba0b000000000702a893

# Actually delete after the target row and delete action are verified
opencli xiaohongshu delete-note 6a08ba0b000000000702a893 --execute
```

> Note: `note` and `comments` now require a full signed note URL with `xsec_token`. `download` accepts either a signed note URL or an `xhslink` short link. Bare note IDs are no longer reliable on xiaohongshu.
> `delete-note` operates in creator center and accepts a 24-character note ID or exact Xiaohongshu note URL; it defaults to dry-run verification and only deletes with `--execute`.

## Prerequisites

- Chrome running and **logged into** xiaohongshu.com
- [Browser Bridge extension](/guide/browser-bridge) installed
