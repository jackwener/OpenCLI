# note.com

**Mode**: 🌐 / 🔐 · **Domain**: `note.com`

## Commands

| Command | Description | Mode |
|---------|-------------|------|
| `opencli note search <query>` | Search note.com articles | 🔐 Browser |
| `opencli note user <username>` | Get note.com user profile | 🌐 Public |
| `opencli note articles <username>` | List articles by a note.com user | 🌐 Public |

## Usage Examples

```bash
# Search articles (requires browser + login)
opencli note search "AI" --limit 5

# User profile
opencli note user masuyohasiri

# User's articles
opencli note articles masuyohasiri --limit 6

# JSON output
opencli note user masuyohasiri -f json
```

## Prerequisites

- `user` and `articles` commands use public API — no browser required
- `search` command requires the opencli Browser Bridge extension and a logged-in note.com session
