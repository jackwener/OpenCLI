# TikTok

**Mode**: 🔐 Browser · **Domain**: `tiktok.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli tiktok profile` | Get user profile info |
| `opencli tiktok search` | Search videos |
| `opencli tiktok explore` | Trending videos from explore page |
| `opencli tiktok user` | Get recent videos from a user |
| `opencli tiktok following` | List accounts you follow |
| `opencli tiktok friends` | Friend suggestions |
| `opencli tiktok live` | Browse live streams |
| `opencli tiktok notifications` | Get notifications |
| `opencli tiktok like` | Like a video |
| `opencli tiktok unlike` | Unlike a video |
| `opencli tiktok save` | Add to Favorites |
| `opencli tiktok unsave` | Remove from Favorites |
| `opencli tiktok follow` | Follow a user |
| `opencli tiktok unfollow` | Unfollow a user |
| `opencli tiktok comment` | Comment on a video |

## Usage Examples

```bash
# View a user's profile
opencli tiktok profile --username tiktok

# Search videos
opencli tiktok search "cooking" --limit 10

# Trending explore videos
opencli tiktok explore --limit 20

# Browse live streams
opencli tiktok live --limit 10

# List who you follow
opencli tiktok following

# Friend suggestions
opencli tiktok friends --limit 10

# Like/unlike a video
opencli tiktok like --url "https://www.tiktok.com/@user/video/123"
opencli tiktok unlike --url "https://www.tiktok.com/@user/video/123"

# Save/unsave (Favorites)
opencli tiktok save --url "https://www.tiktok.com/@user/video/123"
opencli tiktok unsave --url "https://www.tiktok.com/@user/video/123"

# Follow/unfollow
opencli tiktok follow --username nasa
opencli tiktok unfollow --username nasa

# Comment on a video
opencli tiktok comment --url "https://www.tiktok.com/@user/video/123" --text "Great!"

# JSON output
opencli tiktok profile --username tiktok -f json
```

## Prerequisites

- Chrome running and **logged into** tiktok.com
- [Browser Bridge extension](/guide/browser-bridge) installed
