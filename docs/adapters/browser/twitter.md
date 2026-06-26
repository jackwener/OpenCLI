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
| `opencli twitter device-follow` | Read the /i/timeline device-follow notification stream (tweets aggregated under a bell-icon "new posts from @userA and N others" notification) |
| `opencli twitter post` | |
| `opencli twitter reply` | |
| `opencli twitter delete` | |
| `opencli twitter like` | |
| `opencli twitter likes` | |
| `opencli twitter lists` | |
| `opencli twitter list-tweets` | |
| `opencli twitter list-create` | Create a Twitter/X list via GraphQL and return the created list id |
| `opencli twitter list-delete` | Delete a Twitter/X list you own after explicit confirmation |
| `opencli twitter list-add` | |
| `opencli twitter list-add-batch` | Add multiple users to a Twitter/X list you own from a comma-separated username list |
| `opencli twitter list-remove` | |
| `opencli twitter list-remove-batch` | Remove multiple users from a Twitter/X list you own from a comma-separated username list |
| `opencli twitter article` | |
| `opencli twitter follow` | |
| `opencli twitter unfollow` | |
| `opencli twitter bookmark` | |
| `opencli twitter unbookmark` | |
| `opencli twitter block` | |
| `opencli twitter unblock` | |
| `opencli twitter hide-reply` | |
| `opencli twitter download` | Download media from a profile via GraphQL UserMedia pagination, or from one tweet URL |
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

# Download profile media with cursor pagination
opencli twitter download @elonmusk --limit 50 --output ./twitter-media

# Download media from a single tweet
opencli twitter download --tweet-url https://x.com/jack/status/20 --output ./twitter-media

# Create a list and then manage members (requires login)
opencli twitter list-create "AI research" --description "Papers and labs" --mode private
opencli twitter list-delete 123456789 --confirm true
opencli twitter list-add 123456789 alice
opencli twitter list-add-batch 123456789 "@alice,@bob" --interval 5
opencli twitter list-remove 123456789 alice
opencli twitter list-remove-batch 123456789 "@alice,@bob" --interval 5

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
