# Xiaohongshu (小红书)

**Mode**: 🔐 Browser · **Domain**: `xiaohongshu.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli xiaohongshu search` | Search notes by keyword (returns title, author, likes, URL) |
| `opencli xiaohongshu ask` | Ask 点点 and return its answer with citation sources (`sources[]` in JSON) |
| `opencli xiaohongshu note` | Read full note content (title, author, description, likes, collects, comments, tags) |
| `opencli xiaohongshu comments` | Read comments from a note (`--with-replies` for nested 楼中楼 replies) |
| `opencli xiaohongshu feed` | Home feed recommendations (reads the hydrated Pinia store; URLs carry `xsec_token` for drill-down) |
| `opencli xiaohongshu notifications` | User notifications (mentions, likes, connections) |
| `opencli xiaohongshu user` | Get public notes from a user profile |
| `opencli xiaohongshu saved` | List saved/collected notes (`/user/profile/<id>?tab=fav&subTab=note`) |
| `opencli xiaohongshu liked` | List liked notes (`/user/profile/<id>?tab=liked&subTab=note`) |
| `opencli xiaohongshu download` | Download images and videos from a note |
| `opencli xiaohongshu publish` | Publish image-text notes (creator center UI automation) |
| `opencli xiaohongshu delete-note` | Verify or delete a published creator-center note by exact note ID |
| `opencli xiaohongshu follow` | Follow a user from the profile UI and verify the button state flips |
| `opencli xiaohongshu unfollow` | Unfollow a user from the profile UI, confirm the modal, and verify the button state flips |
| `opencli xiaohongshu creator-notes` | Creator's note list with per-note metrics |
| `opencli xiaohongshu creator-note-detail` | Detailed analytics for a single creator note |
| `opencli xiaohongshu creator-notes-summary` | Combined note list + detail analytics summary |
| `opencli xiaohongshu creator-profile` | Creator account info (followers, growth level) |
| `opencli xiaohongshu creator-stats` | Creator data overview (views, likes, collects, trends) |

## Usage Examples

```bash
# Search for notes
opencli xiaohongshu search 美食 --limit 10

# Ask 点点 and keep the citation audit trail
opencli xiaohongshu ask "上海露营需要注意什么？" -f json

# Read a note's full content (pass URL from search results to preserve xsec_token)
opencli xiaohongshu note "https://www.xiaohongshu.com/search_result/<id>?xsec_token=..."

# Read comments with nested replies (楼中楼)
opencli xiaohongshu comments "https://www.xiaohongshu.com/search_result/<id>?xsec_token=..." --with-replies --limit 20

# JSON output
opencli xiaohongshu search 旅行 -f json

# Other commands
opencli xiaohongshu feed
opencli xiaohongshu saved --limit 20
opencli xiaohongshu liked --limit 20
opencli xiaohongshu saved "https://www.xiaohongshu.com/user/profile/<id>?tab=fav&subTab=note"
opencli xiaohongshu liked "https://www.xiaohongshu.com/user/profile/<id>?tab=liked&subTab=note"
opencli xiaohongshu notifications
opencli xiaohongshu download "https://www.xiaohongshu.com/search_result/<id>?xsec_token=..."
opencli xiaohongshu download "https://xhslink.com/..."

# Publish an ordinary image-text note
opencli xiaohongshu publish "正文内容" --title "标题" --images ./a.jpg,./b.png

# Publish a text-image note; split multiple cards with ||| and use \n for card line breaks
opencli xiaohongshu publish "正文内容" --title "标题" --card-text "第一张\\n第二行|||第二张" --card-style 边框

# Follow / unfollow a profile
opencli xiaohongshu follow 5d8f88dc0000000001005d3a
opencli xiaohongshu unfollow https://www.xiaohongshu.com/user/profile/5d8f88dc0000000001005d3a

# Verify a published creator note without deleting it (default dry-run)
opencli xiaohongshu delete-note 6a08ba0b000000000702a893

# Actually delete after the target row and delete action are verified
opencli xiaohongshu delete-note 6a08ba0b000000000702a893 --execute
```

> Note: `note` and `comments` now require a full signed note URL with `xsec_token`. `download` accepts either a signed note URL or an `xhslink` short link. Bare note IDs are no longer reliable on xiaohongshu.
> `ask` is separate from ordinary `search`: it submits the question to 点点, returns `answer`, `source_count`, and `sources[]`, and keeps `xsec_token` in JSON when Xiaohongshu returns one. The current 点点 source API may return bare note IDs without `xsec_token`; in that case `url` falls back to `/explore/<note_id>` and `xsec_token` is an empty string. Each source also carries the engagement and identity metadata 点点 returns: `like_count`, `note_type` (`normal`/`video`), `user_id`, and `published_at` (each omitted when 点点 does not provide it), so citation analysis can read likes and note format without a follow-up `search`/`note` round-trip.
> `delete-note` operates in creator center and accepts a 24-character note ID or exact Xiaohongshu note URL; it defaults to dry-run verification and only deletes with `--execute`.
> `follow` and `unfollow` are write commands on the public profile page. They verify the browser stayed on the requested `/user/profile/<id>` target before clicking, and verify the visible follow-state button after the action.
> `publish --card-text` uses creator-center 文字配图. It requires generated card images to appear in the current composer before filling title/body or submitting. If you request `--card-style`, that exact live page style must be selected; unavailable styles fail instead of silently falling back.

## Prerequisites

- Chrome running and **logged into** xiaohongshu.com
- [Browser Bridge extension](/guide/browser-bridge) installed
