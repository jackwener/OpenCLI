# Medium

**Mode**: 🌗 Mixed · **Domain**: `medium.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli medium feed` | Get hot Medium posts, optionally scoped to a topic |
| `opencli medium search` | Search Medium posts by keyword |
| `opencli medium user` | Get recent articles by a user |
| `opencli medium tag <tag>` | Latest articles for a Medium tag (public RSS, no browser) |

## Usage Examples

```bash
# Get the general Medium feed
opencli medium feed --limit 10

# Search posts by keyword
opencli medium search ai

# Get articles by a user
opencli medium user @username

# Topic feed as JSON
opencli medium feed --topic programming -f json

# Latest articles for a tag (public RSS — fastest, no browser)
opencli medium tag programming --limit 10
opencli medium tag artificial-intelligence --limit 20
```

## `tag` columns

`rank, title, author, description, categories, published, url`

- `description` is the full RSS `<description>` (no silent truncation; pipe through `head` if you want a preview).
- `categories` is comma-joined Medium tags from each item's `<category>` blocks.
- `published` is the original `pubDate` ISO string when available.

## Prerequisites

- `opencli medium search` and `opencli medium tag` can run without a browser (the latter parses `medium.com/feed/tag/<tag>` RSS)
- `opencli medium feed` and `opencli medium user` require Browser Bridge access to `medium.com`
