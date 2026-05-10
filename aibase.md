# AIbase

**Mode**: 🌐 Public · **Domain**: `aibase.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli aibase news` | AIbase daily AI industry news |

## Usage Examples

```bash
# Latest AIbase daily news
opencli aibase news --limit 20

# JSON output
opencli aibase news --limit 10 -f json
```

## Notes

- Returns `rank`, `title`, and stable article `url`.
- Invalid `--limit` values fail fast instead of being silently clamped.
