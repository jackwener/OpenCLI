# Dev.to

**Mode**: 🌐 Public · **Domain**: `dev.to`

Fetch the latest and greatest developer articles from the DEV community without needing an API key.

## Commands

| Command | Description |
|---------|-------------|
| `opencli devto top` | Top DEV.to articles of the day |
| `opencli devto tag` | Latest articles for a specific tag |
| `opencli devto user` | Recent articles from a specific user |

## Usage Examples

```bash
# Top articles today
opencli devto top --limit 5

# Articles by tag (positional argument)
opencli devto tag javascript
opencli devto tag python --limit 20

# Articles by a specific author
opencli devto user ben
opencli devto user thepracticaldev --limit 5

# JSON output
opencli devto top -f json
```

## Prerequisites

- No browser required — uses the public DEV.to API
