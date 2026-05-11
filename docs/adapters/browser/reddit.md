# Reddit

**Mode**: 🔐 Browser · **Domain**: `reddit.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli reddit hot` | Hot posts from a subreddit (or frontpage if none) |
| `opencli reddit frontpage` | Frontpage / r/all listing |
| `opencli reddit home` | **Personalized Best feed (requires login)** |
| `opencli reddit popular` | Trending posts on /r/popular |
| `opencli reddit search` | Search posts |
| `opencli reddit subreddit` | Posts from a specific subreddit, with sort and time filters |
| `opencli reddit subreddit-info` | **Subreddit metadata (subscribers, active, NSFW, created, description)** |
| `opencli reddit read` | Read a post thread with comments |
| `opencli reddit user` | View a user profile |
| `opencli reddit user-posts` | A user's submitted posts |
| `opencli reddit user-comments` | A user's comments |
| `opencli reddit whoami` | **Show the currently logged-in Reddit identity** |
| `opencli reddit upvote` | Vote on a post or comment |
| `opencli reddit save` | Save / unsave a post or comment |
| `opencli reddit comment` | Comment on a post |
| `opencli reddit reply` | Reply to a comment |
| `opencli reddit subscribe` | Join / leave a subreddit |
| `opencli reddit saved` | List your saved items |
| `opencli reddit upvoted` | List your upvoted posts |

## Usage Examples

```bash
# Quick start
opencli reddit hot --limit 5

# Read one subreddit
opencli reddit subreddit python --limit 10

# Subreddit metadata (subscribers / active / NSFW / created / description)
opencli reddit subreddit-info AskReddit

# Personalized Best feed (requires login)
opencli reddit home --limit 10

# Who am I logged in as?
opencli reddit whoami

# Read a post thread
opencli reddit read 1abc123 --depth 2

# Comment on a post
opencli reddit comment 1abc123 "Great post"

# Reply to a comment
opencli reddit reply okf3s7u "Thanks for the context"

# JSON output
opencli reddit hot -f json

# Verbose mode
opencli reddit hot -v
```

## Auth-required commands

`whoami`, `home`, `saved`, `upvoted`, `subscribe`, `upvote`, `save`, `comment`,
and `reply` all require a logged-in `reddit.com` cookie session. When the
session is missing or expired they raise `AuthRequiredError` (exit code 5)
instead of silently returning empty rows.

For `subreddit-info`, missing / banned / private / quarantined subreddits raise
`EmptyResultError` (exit code 6) so the output table never contains a silent
sentinel row.

## Prerequisites

- Chrome running and **logged into** reddit.com
- [Browser Bridge extension](/guide/browser-bridge) installed
