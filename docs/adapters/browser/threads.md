# Threads

**Mode**: 🔐 Browser · **Domain**: `threads.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli threads search` | Search posts (top or most recent) |
| `opencli threads post` | Read a post and its replies |
| `opencli threads user` | A user's recent public posts |

## Usage Examples

```bash
# Search posts
opencli threads search "coffee" --limit 10

# Most recent posts instead of top posts
opencli threads search "Meta Connect" --sort recent --limit 10

# Read a post and its replies (URL or shortcode; threads.net URLs work too)
opencli threads post "https://www.threads.com/@tasteatlas/post/Dd8ZIkwiNKQ" --limit 20
opencli threads post Dd8ZIkwiNKQ

# A user's recent posts, optionally including their replies
opencli threads user zuck --limit 10
opencli threads user @mosseri --replies --limit 10

# JSON output
opencli threads search "coffee" -f json
```

## Prerequisites

- Chrome or Chromium running with the Browser Bridge extension
- Logged in to [threads.com](https://www.threads.com) (via your Instagram account). Logged out, Threads only renders a handful of posts and the commands report `AUTH_REQUIRED` when nothing is visible.

## Notes

- All commands are read-only.
- Data comes from the Relay payload Threads embeds in the page plus the GraphQL pages it loads while scrolling; recommended "related posts" on a post page are excluded.
- Scrolling is deliberately gentle (small steps with pauses), so large `--limit` values take longer. Repeated rapid runs can trigger Threads rate limiting.
