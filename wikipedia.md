# Wikipedia

**Mode**: 🌐 Public · **Domain**: `wikipedia.org`

## Commands

| Command | Description |
|---------|-------------|
| `opencli wikipedia search` | Search Wikipedia articles |
| `opencli wikipedia summary` | Get Wikipedia article summary |
| `opencli wikipedia random` | Random Wikipedia article |
| `opencli wikipedia trending` | Trending Wikipedia articles |
| `opencli wikipedia page <title>` | Full plain-text article extract (optional paragraph cap) |

## Usage Examples

```bash
# Search articles
opencli wikipedia search "quantum computing" --limit 10

# Get article summary
opencli wikipedia summary "Artificial intelligence"

# Get the full article body (plain text, no silent truncation)
opencli wikipedia page "Transformer (deep learning architecture)"

# Cap to first 3 paragraphs explicitly
opencli wikipedia page "Photosynthesis" --paragraphs 3

# Use with other languages
opencli wikipedia search "人工智能" --lang zh
opencli wikipedia page "人工智能" --lang zh --paragraphs 5

# JSON output
opencli wikipedia search "Rust" -f json
```

## Notes

- `summary` returns the lead-section blurb truncated to 300 chars (legacy convention)
- `page` returns the **complete** plain-text article body. Pass `--paragraphs N` to opt into a cap; default `0` means full article — no silent truncation

## Prerequisites

- No browser required — uses public Wikipedia API
