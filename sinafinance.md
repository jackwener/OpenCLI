# 新浪财经 (Sina Finance)

**Mode**: 🌐 Public / 🔐 Browser · **Domain**: `finance.sina.com.cn`

## Commands

| Command | Description | Mode |
|---------|-------------|------|
| `opencli sinafinance news` | 新浪财经 7×24 小时实时快讯 | 🌐 Public |
| `opencli sinafinance rolling-news` | 新浪财经滚动新闻 | 🔐 Browser |
| `opencli sinafinance stock` | 新浪财经行情（A股/港股/美股） | 🌐 Public |
| `opencli sinafinance stock-rank` | 新浪财经热搜榜 | 🔐 Browser |

## Usage Examples

### news - 7×24 实时快讯

```bash
# Latest financial news
opencli sinafinance news --limit 20

# Filter by type
opencli sinafinance news --type 1   # A股
opencli sinafinance news --type 2   # 宏观
opencli sinafinance news --type 6   # 国际

# JSON output
opencli sinafinance news -f json
```

### rolling-news - 滚动新闻

```bash
# Rolling news feed
opencli sinafinance rolling-news

# JSON output
opencli sinafinance rolling-news -f json
```

### stock - 股票行情

```bash
# Search and view A-share stock
opencli sinafinance stock 贵州茅台 --market cn

# Search and view HK stock
opencli sinafinance stock 腾讯控股 --market hk

# Search and view US stock
opencli sinafinance stock aapl --market us

# Auto-detect market (searches cn, hk, us in order)
opencli sinafinance stock 招商证券

# JSON output
opencli sinafinance stock 贵州茅台 -f json
```

### stock-rank - 热搜榜

```bash
# Default A股热搜榜
opencli sinafinance stock-rank

# 港股热搜榜
opencli sinafinance stock-rank --market hk

# 美股热搜榜
opencli sinafinance stock-rank --market us

# 外汇热搜榜
opencli sinafinance stock-rank --market ft

# 期货热搜榜
opencli sinafinance stock-rank --market wh

# JSON output
opencli sinafinance stock-rank -f json
```

## Options

### news

| Option | Description |
|--------|-------------|
| `--limit` | Max results, up to 50 (default: 20) |
| `--type` | News type: `0`=全部, `1`=A股, `2`=宏观, `3`=公司, `4`=数据, `5`=市场, `6`=国际, `7`=观点, `8`=央行, `9`=其它 |

### stock

| Option | Description |
|--------|-------------|
| `--market` | Market: `cn`, `hk`, `us`, `auto` (default: auto). When `auto`, searches in cn, hk, us order |

### stock-rank

| Option | Description |
|--------|-------------|
| `--market` | Market: `cn` (A股, 默认), `ft` (期货), `us` (美股), `wh` (外汇), `hk` (港股) |

## Prerequisites

- `news` & `stock`: No browser required — uses public API
- `rolling-news` & `stock-rank`: Chrome running and **logged into** `finance.sina.com.cn`
- For `rolling-news` & `stock-rank`: [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `news` and `stock` use public APIs — no browser or login needed
- `stock` supports Chinese names, Chinese codes, and ticker symbols; auto-detects market
- Market priority for auto-detection: cn (A股) → hk (港股) → us (美股)
- US stock `High`/`Low` columns show 52-week range; A股/港股 show today's range
- `stock-rank` scrapes the hot search list from the Sina Finance homepage; requires browser login
