# Reddit

**Mode**: 🔐 Browser · **Domain**: `reddit.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli reddit hot` | |
| `opencli reddit frontpage` | |
| `opencli reddit popular` | |
| `opencli reddit search` | |
| `opencli reddit subreddit` | |
| `opencli reddit read` | |
| `opencli reddit user` | |
| `opencli reddit user-posts` | |
| `opencli reddit user-comments` | |
| `opencli reddit upvote` | |
| `opencli reddit save` | |
| `opencli reddit comment` | |
| `opencli reddit subscribe` | |
| `opencli reddit saved` | |
| `opencli reddit upvoted` | |

## Usage Examples

```bash
# Quick start
opencli reddit hot --limit 5

# Read one subreddit
opencli reddit subreddit python --limit 10

# Read a post thread
opencli reddit read 1abc123 --depth 2

# Comment on a post
opencli reddit comment 1abc123 "Great post"

# JSON output
opencli reddit hot -f json

# Verbose mode
opencli reddit hot -v
```

## Prerequisites

- Chrome running and **logged into** reddit.com
- [Browser Bridge extension](/guide/browser-bridge) installed
