# Xueqiu (雪球)

**Mode**: 🔐 Browser · **Domain**: `xueqiu.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli xueqiu feed` | |
| `opencli xueqiu earnings-date` | |
| `opencli xueqiu hot-stock` | |
| `opencli xueqiu hot` | |
| `opencli xueqiu search` | |
| `opencli xueqiu stock` | |
| `opencli xueqiu watchlist` | |

## Usage Examples

```bash
# Quick start
opencli xueqiu feed --limit 5

# Search stocks
opencli xueqiu search 茅台

# View one stock
opencli xueqiu stock SH600519

# Upcoming earnings dates
opencli xueqiu earnings-date SH600519 --next

# JSON output
opencli xueqiu feed -f json

# Verbose mode
opencli xueqiu feed -v
```

## Prerequisites

- Chrome running and **logged into** xueqiu.com
- [Browser Bridge extension](/guide/browser-bridge) installed
