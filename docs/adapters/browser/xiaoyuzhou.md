# Xiaoyuzhou (小宇宙)

**Mode**: 🌐 Public · **Domain**: `xiaoyuzhou.fm`

## Commands

| Command | Description |
|---------|-------------|
| `opencli xiaoyuzhou podcast` | |
| `opencli xiaoyuzhou podcast-episodes` | |
| `opencli xiaoyuzhou episode` | |
| `opencli xiaoyuzhou download` | Download episode audio |

## Usage Examples

```bash
# Podcast profile
opencli xiaoyuzhou podcast 6013f9f58e2f7ee375cf4216

# Recent episodes
opencli xiaoyuzhou podcast-episodes 6013f9f58e2f7ee375cf4216 --limit 5

# Episode details
opencli xiaoyuzhou episode 69b3b675772ac2295bfc01d0

# Download episode audio
opencli xiaoyuzhou download 69b3b675772ac2295bfc01d0 --output ./xiaoyuzhou

# JSON output
opencli xiaoyuzhou episode 69b3b675772ac2295bfc01d0 -f json

# Verbose mode
opencli xiaoyuzhou download 69b3b675772ac2295bfc01d0 -v
```

## Prerequisites

- No browser required — uses public episode pages
