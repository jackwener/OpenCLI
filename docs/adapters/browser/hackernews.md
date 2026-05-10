# HackerNews

**Mode**: 🌐 Public · **Domain**: `news.ycombinator.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli hackernews top` | Hacker News top stories |
| `opencli hackernews new` | Hacker News newest stories |
| `opencli hackernews best` | Hacker News best stories |
| `opencli hackernews ask` | Hacker News Ask HN posts |
| `opencli hackernews show` | Hacker News Show HN posts |
| `opencli hackernews jobs` | Hacker News job postings |
| `opencli hackernews search <query>` | Search Hacker News stories |
| `opencli hackernews user <username>` | Hacker News user profile |
| `opencli hackernews read <id>` | Read a story and its comment tree |

## Usage Examples

```bash
# Top stories
opencli hackernews top --limit 5

# Newest stories
opencli hackernews new --limit 10

# Search stories
opencli hackernews search "machine learning" --limit 5

# User profile
opencli hackernews user pg

# JSON output
opencli hackernews top -f json

# Sort search by date
opencli hackernews search "rust" --sort date

# Read a story and its top comments (id from any listing's `id` column)
opencli hackernews read 47999636 --limit 5 --depth 2
```

## Prerequisites

- No browser required — uses public API
