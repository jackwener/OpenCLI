# xueqiu

## Commands

### comments
- Purpose: 获取单只股票的讨论动态
- Args:
  - `symbol`(required); Stock symbol, e.g. SH600519, AAPL, or 00700
  - `limit`(optional; type: int; default: 20); Number of discussion posts to return
- Usage: `opencli xueqiu comments [options] -f json`

### earnings-date
- Purpose: Get expected earnings release dates
- Args: None
- Usage: `opencli xueqiu earnings-date [options] -f json`

### feed
- Purpose: Get Xueqiu home feed (followed users)
- Args: None
- Usage: `opencli xueqiu feed [options] -f json`

### fund-holdings
- Purpose: 获取蛋卷基金持仓明细（可用 --account 按子账户过滤）
- Args:
  - `account`(optional; type: str; default: ''); 按子账户名称或 ID 过滤
- Usage: `opencli xueqiu fund-holdings [options] -f json`

### fund-snapshot
- Purpose: 获取蛋卷基金快照（总资产、子账户、持仓，推荐 -f json 输出）
- Args: None
- Usage: `opencli xueqiu fund-snapshot [options] -f json`

### hot
- Purpose: Get Xueqiu hot feed
- Args: None
- Usage: `opencli xueqiu hot [options] -f json`

### hot-stock
- Purpose: Get Xueqiu hot stocks ranking
- Args: None
- Usage: `opencli xueqiu hot-stock [options] -f json`

### search
- Purpose: Search Xueqiu stocks (ticker or name)
- Args: None
- Usage: `opencli xueqiu search [options] -f json`

### stock
- Purpose: Get Xueqiu real-time quote
- Args: None
- Usage: `opencli xueqiu stock [options] -f json`

### watchlist
- Purpose: Get Xueqiu watchlist
- Args: None
- Usage: `opencli xueqiu watchlist [options] -f json`
