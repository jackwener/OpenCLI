# tonghuashun（同花顺 / ths）

## 域名

| 用途 | 域名 |
|------|------|
| 行情页 / 热榜 | `q.10jqka.com.cn` |
| 数据中心（多维筛选） | `data.10jqka.com.cn` |
| 行情推送 | `d.10jqka.com.cn` / `dq.10jqka.com.cn` |
| 基本面 / F10 | `basic.10jqka.com.cn` |
| 资讯 / 新闻 | `news.10jqka.com.cn` |

## 默认鉴权

- `Strategy.COOKIE + browser: true`（多数接口有 cookie 风控）
- `Referer: http://q.10jqka.com.cn/` 是关键 header，很多接口缺它直接返回空
- 有些 JSONP 接口没 cookie 要求，但 Referer 还是要带
- 不支持登录态扩展（加密/签名客户端逻辑复杂）

## 已知 endpoint

- `GET d.10jqka.com.cn/v6/line/hs_<code>/01/last1200.js` — K 线（JSONP，返回 `quotebridge_v6_line_...({...})`）
- `GET q.10jqka.com.cn/thsq/quote/v6/<code>` — 实时行情快照（页面内 XHR）
- `GET q.10jqka.com.cn/stock/attention/` — 热度榜（HTML，抽表）
- `GET data.10jqka.com.cn/funds/ggzjl/field/zdf/order/desc/page/1/ajax/1/` — 资金流排行（HTML 表格 + JSONP 混合）
- `GET news.10jqka.com.cn/tapp/news/push/stock/?tag=&page=1&limit=20` — 快讯
- `GET data.10jqka.com.cn/ifinance/hotNews/` — 热点新闻

## 字段

见 `../field-conventions.md` 的 tonghuashun 节（`openPrice / closePrice / zdf / hsl / zf` 等）。

数值字段多数是字符串（带百分号或"万"单位），解析时 `parseFloat` 并处理单位。

## 坑 / 陷阱

1. **`Referer` 必须带**，否则 302 到错误页
2. **多数 JSONP 接口回调名固定**：`quotebridge_v6_...`，adapter 里直接 `.replace(/^[\w_]+\((.*)\)$/, '$1')` 剥壳再 JSON.parse
3. **HTML 表格接口**（如资金流）：`page.evaluate` 里 `document.querySelectorAll('table tr')` 抽，每列顺序在同类 adapter 之间复用
4. **`<code>` 格式 `hs_600000`**：hs 是上海，sz 是深圳；港美股前缀不同
5. **数据中心接口有日期快照切换**：`date=YYYYMMDD` 参数默认当天，历史日期要显式传
6. **限频特别严**：连续 10 次会跳风控页，adapter 层 1s 间隔起
7. **响应 gzip 强制**：某些接口不带 Accept-Encoding 会 406，`fetch` 默认 OK，node 原生 http 要显式加

## 可参考的 adapter

| 模板类型 | 参考文件 |
|---------|---------|
| 热度榜 | `clis/ths/hot-rank.js`（目前唯一一个，其他待补） |

ths 覆盖度低，新写 adapter 参考 eastmoney 同类型 adapter 的结构，把 URL / 解析逻辑换成 ths 版本。
