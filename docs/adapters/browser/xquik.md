# Xquik

**Mode**: Local API key - **Domain**: `xquik.com`

Xquik provides read-only X/Twitter data endpoints for post search, post lookup, user lookup, user timelines, user search, and regional trends. Set `XQUIK_API_KEY` in the shell before running these commands.

## Commands

| Command | Description |
|---------|-------------|
| `opencli xquik search <query>` | Search public X/Twitter posts with X search operators |
| `opencli xquik tweet <id>` | Look up one public post by ID |
| `opencli xquik user <id>` | Look up a user profile by username or ID |
| `opencli xquik user-search <query>` | Search users by name or username |
| `opencli xquik user-tweets <id>` | List recent posts from one user |
| `opencli xquik trends` | Get trending topics by region WOEID |

## Usage Examples

```bash
export XQUIK_API_KEY=...

opencli xquik search "opencli from:xquikcom" --limit 5
opencli xquik search "AI has:media" --queryType Top --limit 10
opencli xquik tweet 1234567890
opencli xquik user xquikcom
opencli xquik user-search "xquik"
opencli xquik user-tweets xquikcom --includeReplies true
opencli xquik trends --woeid 1 --count 10
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, id, author, text, createdAt, likes, replies, retweets, views, url, nextCursor` |
| `tweet` | `id, author, text, createdAt, likes, replies, retweets, quotes, views, url` |
| `user` | `id, username, name, followers, following, verified, description, location, createdAt, profileUrl` |
| `user-search` | `rank, id, username, name, followers, following, verified, description, profileUrl` |
| `user-tweets` | `rank, id, author, text, createdAt, likes, replies, retweets, views, url, nextCursor` |
| `trends` | `rank, name, description, query, woeid` |

## Options

### `search`

| Option | Description |
|--------|-------------|
| `query` (positional) | X search query, including operators such as `from:user`, `has:media`, or `since:YYYY-MM-DD` |
| `--limit` | Max posts to return, 1 to 200, default 20 |
| `--queryType` | `Latest` or `Top`, default `Latest` |
| `--cursor` | Cursor returned from a prior page |
| `--sinceTime` | ISO 8601 lower bound |
| `--untilTime` | ISO 8601 upper bound |

### `tweet`

| Option | Description |
|--------|-------------|
| `id` (positional) | Numeric post ID |

### `user`

| Option | Description |
|--------|-------------|
| `id` (positional) | Username with or without `@`, or numeric user ID |

### `user-search`

| Option | Description |
|--------|-------------|
| `query` (positional) | User search query |
| `--cursor` | Cursor returned from a prior page |

### `user-tweets`

| Option | Description |
|--------|-------------|
| `id` (positional) | Username with or without `@`, or numeric user ID |
| `--cursor` | Cursor returned from a prior page |
| `--includeReplies` | Include reply posts |
| `--includeParentTweet` | Include parent tweet details for replies |

### `trends`

| Option | Description |
|--------|-------------|
| `--woeid` | Region WOEID, default `1` for worldwide |
| `--count` | Number of trends to return, 1 to 50, default 30 |

## Notes

- The adapter reads the API key from `XQUIK_API_KEY` and sends it as `x-api-key`.
- Commands are read-only. They do not post, like, follow, send DMs, or request X login material.
- Paginated commands return `nextCursor` so you can pass it back with `--cursor`.
