# THS

**Mode**: 🔐 Browser · **Domain**: `eq.10jqka.com.cn`

Access 同花顺 (Tonghuashun / THS) hot-stock data from the terminal.

## Commands

| Command | Description |
|---------|-------------|
| `opencli ths hot-rank` | 同花顺热股榜 (THS hot-stock ranking) |

## Usage Examples

```bash
# Top 20 hot stocks (default)
opencli ths hot-rank

# Top 50 hot stocks
opencli ths hot-rank --limit 50

# JSON output
opencli ths hot-rank -f json
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--limit` | `20` | 返回数量 (number of rows to return) |

## Output Columns

`rank` · `name` · `changePercent` · `heat` · `tags`

## Prerequisites

- Chrome extension installed and connected
- Visit `eq.10jqka.com.cn` once in the browser so cookies are populated
