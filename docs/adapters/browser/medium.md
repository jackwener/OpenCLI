# Medium

**Mode**: 🌗 Mixed · **Domain**: `medium.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli medium feed` | Get hot Medium posts, optionally scoped to a topic |
| `opencli medium search` | Search Medium posts by keyword |
| `opencli medium user` | Get recent articles by a user |

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
```

## Prerequisites

- `opencli medium search` can run without a browser
- `opencli medium feed` and `opencli medium user` require Browser Bridge access to `medium.com`
