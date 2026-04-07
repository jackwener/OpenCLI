# sinafinance

## Commands

### news
- Purpose: Sina Finance 24/7 real-time news feed
- Args:
  - `limit`(optional; type: int; default: 20); Max results (max 50)
  - `type`(optional; type: int; default: 0); News type: 0=全部 1=A股 2=宏观 3=公司 4=数据 5=市场 6=国际 7=观点 8=央行 9=其它
- Usage: `opencli sinafinance news [options] -f json`

### rolling-news
- Purpose: 新浪财经滚动新闻
- Args: None
- Usage: `opencli sinafinance rolling-news [options] -f json`

### stock
- Purpose: 新浪财经行情（A股/港股/美股）
- Args:
  - `key`(required; type: string); Stock name or code (e.g. 贵州茅台, 腾讯控股, AAPL)
  - `market`(optional; type: string; default: 'auto'); Market: cn, hk, us, auto (default: auto searches cn → hk → us)
- Usage: `opencli sinafinance stock [options] -f json`

### stock-rank
- Purpose: 新浪财经热搜榜
- Args:
  - `market`(optional; type: string; default: 'cn'); Market: cn (A股), hk (港股), us (美股), wh (外汇), ft (期货)
- Usage: `opencli sinafinance stock-rank [options] -f json`
