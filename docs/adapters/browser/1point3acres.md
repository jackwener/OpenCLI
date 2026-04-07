# 1Point3Acres

**Mode**: 🔐 Browser · **Domain**: `1point3acres.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli 1point3acres hot` | Hot forum topics |

## Usage Examples

```bash
# Hot topics
opencli 1point3acres hot --limit 10

# JSON output
opencli 1point3acres hot --limit 10 -f json
```

## Prerequisites

- Chrome running with the [Browser Bridge extension](/guide/browser-bridge) installed
- Chrome logged into `1point3acres.com`
- Cloudflare challenge passed in Chrome before running the command

## Notes

- The command reads `https://www.1point3acres.com/bbs/forum.php?mod=guide`.
- Output columns: `rank`, `title`, `category`, `replies`, `views`, `last_reply`, `url`.
