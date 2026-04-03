# Wikipedia

**Mode**: 🌐 Public · **Domain**: `wikipedia.org`

## Commands

| Command | Description |
|---------|-------------|
| `opencli wikipedia search` | Search Wikipedia articles |
| `opencli wikipedia summary` | Get Wikipedia article summary |
| `opencli wikipedia random` | Random Wikipedia article |
| `opencli wikipedia trending` | Trending Wikipedia articles |

## Usage Examples

```bash
# Search articles
opencli wikipedia search "quantum computing" --limit 10

# Get article summary
opencli wikipedia summary "Artificial intelligence"

# Use with other languages
opencli wikipedia search "人工智能" --lang zh

# JSON output
opencli wikipedia search "Rust" -f json
```

## Prerequisites

- No browser required — uses public Wikipedia API
