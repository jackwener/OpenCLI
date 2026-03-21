# Instagram

**Mode**: 🔐 Browser · **Domain**: `instagram.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli instagram profile` | Get user profile info |
| `opencli instagram search` | Search users |
| `opencli instagram user` | Get recent posts from a user |
| `opencli instagram explore` | Discover trending posts |
| `opencli instagram followers` | List user's followers |
| `opencli instagram following` | List user's following |
| `opencli instagram saved` | Get your saved posts |
| `opencli instagram like` | Like a post |
| `opencli instagram unlike` | Unlike a post |
| `opencli instagram comment` | Comment on a post |
| `opencli instagram save` | Bookmark a post |
| `opencli instagram unsave` | Remove bookmark |
| `opencli instagram follow` | Follow a user |
| `opencli instagram unfollow` | Unfollow a user |

## Usage Examples

```bash
# View a user's profile
opencli instagram profile --username nasa

# Search users
opencli instagram search --query nasa --limit 5

# View a user's recent posts
opencli instagram user --username nasa --limit 10

# Like a user's most recent post
opencli instagram like --username nasa --index 1

# Comment on a post
opencli instagram comment --username nasa --text "Amazing!" --index 1

# Follow/unfollow
opencli instagram follow --username nasa
opencli instagram unfollow --username nasa

# JSON output
opencli instagram profile --username nasa -f json
```

## Prerequisites

- Chrome running and **logged into** instagram.com
- [Browser Bridge extension](/guide/browser-bridge) installed
