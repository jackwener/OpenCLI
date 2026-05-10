# Tieba

**Mode**: 🔐 Browser · **Domain**: `tieba.baidu.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli tieba hot` | Read Tieba trending topics |
| `opencli tieba posts <forum>` | List threads in one forum |
| `opencli tieba search <keyword>` | Search threads across Tieba |
| `opencli tieba read <thread-id>` | Read one thread page |

## Usage Examples

```bash
# Trending topics
opencli tieba hot --limit 5

# List forum threads
opencli tieba posts 李毅 --limit 10

# Search Tieba
opencli tieba search 编程 --limit 10

# Read one thread
opencli tieba read 10163164720 --limit 10

# Read page 2 of a thread
opencli tieba read 10163164720 --page 2 --limit 10

# JSON output
opencli tieba hot -f json
```

## Notes

- `tieba search` currently supports only `--page 1`
- `tieba read --limit` counts reply rows; page 1 may also include the main post

## Prerequisites

- Chrome running and able to open `tieba.baidu.com`
- [Browser Bridge extension](/guide/browser-bridge) installed
- For `posts`, `search`, and `read`, a valid Tieba login session in Chrome is recommended
