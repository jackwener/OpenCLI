# Toutiao (头条号创作者后台)

**Mode**: 🔐 Browser · **Domain**: `mp.toutiao.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli toutiao articles` | List articles from the 头条号 creator dashboard with publish status and basic metrics |

## Usage Examples

```bash
# First page
opencli toutiao articles

# Specific page
opencli toutiao articles --page 2

# JSON output
opencli toutiao articles --page 1 -f json
```

## Output

The command returns:

- `title`
- `date`
- `status`
- `展现`
- `阅读`
- `点赞`
- `评论`

## Prerequisites

- Chrome running and **logged into** `mp.toutiao.com`
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- Current implementation reads the creator content list page and extracts article rows from the rendered page text.
- `--page` currently targets pages `1-4`, matching the contributor's verified range on the creator dashboard.
