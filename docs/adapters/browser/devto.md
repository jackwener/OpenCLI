# Dev.to

**Mode**: 🌐 Public · **Domain**: `dev.to`

Fetch the latest and greatest developer articles from the DEV community without needing an API key.

## Commands

| Command | Description |
|---------|-------------|
| `opencli devto top` | Get top DEV.to articles globally |
| `opencli devto tag` | Get latest DEV.to articles for a specific tag |
| `opencli devto user` | Get recent DEV.to articles from a specific user |

## Usage Examples

```bash
# Get top articles on dev.to
opencli devto top --limit 5

# Discover the latest javascript articles
opencli devto tag --tag "javascript"

# Follow a specific author
opencli devto user --username "ben"
```

## Prerequisites

- No browser required — uses the fast, public DEV API.
