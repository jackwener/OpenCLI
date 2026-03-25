# xueqiu

## Commands

### earnings-date
- 用途：获取股票预计财报发布日期（公司大事）
- 参数：
  - `symbol`（必填）：类型 str；股票代码，如 SH600519、SZ000858、00700
  - `next`（可选）：类型 bool；默认值 false；仅返回最近一次未发布的财报日期
  - `limit`（可选）：类型 int；默认值 10；返回数量，默认 10
- 用法：`opencli xueqiu earnings-date [options] -f json`

### feed
- 用途：获取雪球首页时间线（关注用户的动态）
- 参数：
  - `page`（可选）：类型 int；默认值 1；页码，默认 1
  - `limit`（可选）：类型 int；默认值 20；每页数量，默认 20
- 用法：`opencli xueqiu feed [options] -f json`

### hot
- 用途：获取雪球热门动态
- 参数：
  - `limit`（可选）：类型 int；默认值 20；返回数量，默认 20，最大 50
- 用法：`opencli xueqiu hot [options] -f json`

### hot-stock
- 用途：获取雪球热门股票榜
- 参数：
  - `limit`（可选）：类型 int；默认值 20；返回数量，默认 20，最大 50
  - `type`（可选）：类型 str；默认值 "10"；榜单类型 10=人气榜(默认) 12=关注榜
- 用法：`opencli xueqiu hot-stock [options] -f json`

### search
- 用途：搜索雪球股票（代码或名称）
- 参数：
  - `query`（必填）：类型 str；搜索关键词，如 茅台、AAPL、腾讯
  - `limit`（可选）：类型 int；默认值 10；返回数量，默认 10
- 用法：`opencli xueqiu search [options] -f json`

### stock
- 用途：获取雪球股票实时行情
- 参数：
  - `symbol`（必填）：类型 str；股票代码，如 SH600519、SZ000858、AAPL、00700
- 用法：`opencli xueqiu stock [options] -f json`

### watchlist
- 用途：获取雪球自选股列表
- 参数：
  - `category`（可选）：类型 str # using str to prevent parsing issues like 01；默认值 "1"；"分类：1=自选(默认) 2=持仓 3=关注"
  - `limit`（可选）：类型 int；默认值 100；默认 100
- 用法：`opencli xueqiu watchlist [options] -f json`
