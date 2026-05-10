# 微信读书 (WeRead)

**Mode**: 🔐 Browser · **Domain**: `weread.qq.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli weread shelf` | List books on your bookshelf |
| `opencli weread search` | Search books on WeRead |
| `opencli weread book` | View book details |
| `opencli weread ranking` | Book rankings by category |
| `opencli weread notebooks` | List books that have highlights or notes |
| `opencli weread highlights` | List your highlights (underlines) in a book |
| `opencli weread notes` | List your notes (thoughts) on a book |

## Usage Examples

```bash
# View your bookshelf
opencli weread shelf --limit 20

# Search books
opencli weread search "三体"

# View book details
opencli weread book <book-id>

# Book rankings
opencli weread ranking --limit 10

# List books with notes/highlights
opencli weread notebooks

# View highlights for a book
opencli weread highlights <book-id>

# View your notes
opencli weread notes <book-id>

# JSON output
opencli weread shelf -f json
```

## Prerequisites

- Chrome running and **logged into** weread.qq.com
- [Browser Bridge extension](/guide/browser-bridge) installed
