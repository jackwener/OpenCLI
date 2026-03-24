# Xueqiu (雪球)

**Mode**: 🔐 Browser · **Domain**: `xueqiu.com` / `danjuanfunds.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli xueqiu feed` | 获取雪球首页时间线 |
| `opencli xueqiu earnings-date` | 获取股票预计财报发布日期 |
| `opencli xueqiu hot-stock` | 获取雪球热门股票榜 |
| `opencli xueqiu hot` | 获取雪球热门动态 |
| `opencli xueqiu search` | 搜索雪球股票（代码或名称） |
| `opencli xueqiu stock` | 获取雪球股票实时行情 |
| `opencli xueqiu watchlist` | 获取雪球自选股列表 |
| `opencli xueqiu fund-accounts` | 获取雪球基金（蛋卷）子账户汇总信息 |
| `opencli xueqiu fund-holdings --account <nameOrId>` | 获取雪球基金（蛋卷）全部子账户持仓与份额信息，可按子账户过滤 |
| `opencli xueqiu fund-snapshot` | 获取雪球基金（蛋卷）当前快照（总资产、子账户、持仓明细） |

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

# Danjuan / fund account overview
opencli xueqiu fund-accounts

# Danjuan all holdings with shares
opencli xueqiu fund-holdings

# Filter one Danjuan sub-account
opencli xueqiu fund-holdings --account 默认账户
opencli xueqiu fund-holdings --account T0201314857

# Full Danjuan snapshot as JSON
opencli xueqiu fund-snapshot -f json

# JSON output
opencli xueqiu feed -f json

# Verbose mode
opencli xueqiu feed -v
```

## Prerequisites

- Chrome running and **logged into** `xueqiu.com`
- For fund account commands, Chrome must also be logged into `danjuanfunds.com` and able to open `https://danjuanfunds.com/my-money`
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `fund-holdings` exposes both market value and share fields, including `volume` and `usableRemainShare`
- `fund-snapshot -f json` is the easiest way to persist a full account snapshot for later analysis or diffing
- If the commands return empty data, first confirm the logged-in browser can directly see the Danjuan asset page
