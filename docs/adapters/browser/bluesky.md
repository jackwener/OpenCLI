# Bluesky

**Mode**: 🌐 Public · **Domain**: `bsky.app`

## Commands

| Command | Description |
|---------|-------------|
| `opencli bluesky profile` | User profile info |
| `opencli bluesky user` | Recent posts from a user |
| `opencli bluesky trending` | Trending topics |
| `opencli bluesky search` | Search users |
| `opencli bluesky feeds` | Popular feed generators |
| `opencli bluesky followers` | User's followers |
| `opencli bluesky following` | Accounts a user follows |
| `opencli bluesky thread` | Post thread with replies |
| `opencli bluesky starter-packs` | User's starter packs |

## Usage Examples

```bash
# User profile
opencli bluesky profile --handle bsky.app

# Recent posts
opencli bluesky user --handle bsky.app --limit 10

# Trending topics
opencli bluesky trending --limit 10

# Search users
opencli bluesky search --query "AI" --limit 10

# Popular feeds
opencli bluesky feeds --limit 10

# Followers / following
opencli bluesky followers --handle bsky.app --limit 10
opencli bluesky following --handle bsky.app

# Post thread with replies
opencli bluesky thread --uri "at://did:.../app.bsky.feed.post/..."

# Starter packs
opencli bluesky starter-packs --handle bsky.app

# JSON output
opencli bluesky profile --handle bsky.app -f json
```

## Prerequisites

None — all commands use the public Bluesky AT Protocol API, no browser or login required.
