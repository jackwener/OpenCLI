# Medium

**Mode**: 🌐 Public · **Domain**: `medium.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli medium publication` | Get recent articles from a publication |
| `opencli medium tag` | Get top articles for a tag |
| `opencli medium user` | Get recent articles by a user |

## Usage Examples

```bash
# Get articles from a publication
opencli medium publication --name towards-data-science

# Get top articles for a tag
opencli medium tag --name programming

# Get articles by a user
opencli medium user --name @username

# JSON output
opencli medium tag --name ai -f json
```

## Prerequisites

None — all commands use public endpoints, no browser or login required.
