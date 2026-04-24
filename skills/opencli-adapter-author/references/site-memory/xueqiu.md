# xueqiu（雪球）

## 域名

| 用途 | 域名 |
|------|------|
| 行情 / 搜索 / 关注列表 | `stock.xueqiu.com` / `xueqiu.com` |
| 动态 / 评论 / 热帖 | `xueqiu.com` |
| 基金（蛋卷） | `danjuanfunds.com` |

## 默认鉴权

- `Strategy.COOKIE + browser: true`
- 核心 cookie：`xq_a_token`（匿名也有，登录后含用户身份）
- `page.evaluate` 里 `fetch(url, { credentials: 'include' })` 带 cookie
- 浏览器先访问一次 `xueqiu.com` 触发 cookie 下发，再去调接口（否则 `xq_a_token` 不存在 → 400）

## 已知 endpoint

- `GET stock.xueqiu.com/v5/stock/quote.json?symbol=SH600000` — 单股详情
- `GET stock.xueqiu.com/v5/stock/batch/quote.json?symbol=SH600000,SZ000001` — 批量报价
- `GET stock.xueqiu.com/v5/stock/chart/kline.json?symbol=SH600000&begin=<ts>&period=day&type=before&count=-100` — K 线
- `GET stock.xueqiu.com/v5/stock/screener/quote/list.json?market=CN&type=sh_sz` — 排行
  - 可选：`order_by=percent`（涨幅）/ `volume`（成交量）/ `amount`（成交额）/ `market_capital`
- `GET stock.xueqiu.com/v5/stock/search.json?keyword=<q>` — 搜索
- `GET xueqiu.com/statuses/hot/list.json?since_id=-1&max_id=-1&size=20&type=stock` — 热门帖
- `GET xueqiu.com/statuses/search.json?source=all&q=<q>` — 动态搜索
- `GET xueqiu.com/service/v5/stock/portfolio/list.json` — 关注组合（需登录）
- `GET xueqiu.com/v4/statuses/user_timeline.json?user_id=<uid>` — 用户动态

## 字段

字段基本人类可读（`symbol / name / current / chg / percent / volume / amount / market_capital / pe_ttm / pb`），详见 `../field-conventions.md` 的 xueqiu 节。

## 坑 / 陷阱

1. **必须先访问首页**：冷启动直接调 API 会 400 `cookie is invalid`，先 `page.goto('https://xueqiu.com/')` 再 fetch
2. **`symbol` 前缀硬编码**：SH/SZ/HK/US —— 港股 `00700` 是 `'HK00700'`，美股 `AAPL` 是 `'AAPL'`（无前缀）
3. **kline 的 `begin` 是毫秒 unix**，不是秒
4. **screener 的 `type`**：`sh_sz / hk / us` 必传，漏了拿空数组
5. **评论接口 `comments.json` 要传 `statusId`**，不是 `status_id`
6. **限频明显**：同 symbol 短时间反复调会 403，adapter 层建议加 300ms 间隔
7. **蛋卷基金（`danjuanfunds.com`）是独立子品牌**：cookie 域不同，要单独获取

## 可参考的 adapter

| 模板类型 | 参考文件 |
|---------|---------|
| 单股 / 批量报价 | `clis/xueqiu/stock.js` |
| K 线 | `clis/xueqiu/kline.js` |
| 排行 | `clis/xueqiu/hot-stock.js` |
| 热帖 / feed | `clis/xueqiu/hot.js` / `feed.js` |
| 关注 | `clis/xueqiu/watchlist.js` |
| 搜索 | `clis/xueqiu/search.js` |
| 评论 | `clis/xueqiu/comments.js` |
| 基金持仓（蛋卷） | `clis/xueqiu/fund-holdings.js` |

工具：`clis/xueqiu/utils.js` 有 `fetchWithRetry` + symbol normalize，直接用别重写。
