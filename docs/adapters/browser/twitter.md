# Twitter / X

**Mode**: 🔐 Browser · **Domain**: `twitter.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli twitter trending` | |
| `opencli twitter bookmarks` | |
| `opencli twitter profile` | |
| `opencli twitter search` | |
| `opencli twitter timeline` | |
| `opencli twitter thread` | |
| `opencli twitter following` | |
| `opencli twitter followers` | |
| `opencli twitter notifications` | |
| `opencli twitter post` | |
| `opencli twitter reply` | |
| `opencli twitter delete` | |
| `opencli twitter like` | |
| `opencli twitter likes` | |
| `opencli twitter lists` | |
| `opencli twitter list-tweets` | |
| `opencli twitter list-add` | |
| `opencli twitter list-remove` | |
| `opencli twitter article` | |
| `opencli twitter follow` | |
| `opencli twitter unfollow` | |
| `opencli twitter bookmark` | |
| `opencli twitter unbookmark` | |
| `opencli twitter block` | |
| `opencli twitter unblock` | |
| `opencli twitter hide-reply` | |
| `opencli twitter download` | |
| `opencli twitter accept` | |
| `opencli twitter reply-dm` | |
| `opencli twitter unlike` | |
| `opencli twitter retweet` | |
| `opencli twitter unretweet` | |
| `opencli twitter quote` | |

## Usage Examples

```bash
# Quick start
opencli twitter trending --limit 5

# Search top tweets (default)
opencli twitter search "react 19"

# Search latest/live tweets
opencli twitter search "react 19" --filter live

# Get following/followers list (supports large limits)
opencli twitter following @elonmusk --limit 200
opencli twitter followers @elonmusk --limit 100

# Write actions (require login). Idempotent — calling twice is safe.
opencli twitter like https://x.com/jack/status/20
opencli twitter unlike https://x.com/jack/status/20
opencli twitter retweet https://x.com/jack/status/20
opencli twitter unretweet https://x.com/jack/status/20
opencli twitter quote https://x.com/jack/status/20 "great take"

# JSON output
opencli twitter trending -f json

# Verbose mode
opencli twitter trending -v
```

## Prerequisites

- Chrome running and **logged into** twitter.com
- [Browser Bridge extension](/guide/browser-bridge) installed
