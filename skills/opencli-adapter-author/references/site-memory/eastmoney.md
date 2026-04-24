# eastmoney（东方财富）

## 域名

| 用途 | 域名 |
|------|------|
| 行情列表 / 批量报价 | `push2.eastmoney.com` |
| K 线历史 | `push2his.eastmoney.com` |
| 报表类（龙虎榜 / 十大股东） | `datacenter-web.eastmoney.com` |
| 7x24 快讯 | `np-listapi.eastmoney.com` |
| 公司公告 | `np-anotice-stock.eastmoney.com` |
| 静态页（网页端入口） | `quote.eastmoney.com` / `data.eastmoney.com` |

## 默认鉴权

- `Strategy.PUBLIC + browser: false`
- 统一带 `ut=bd1d9ddb04089700cf9c27f6f7426281`（push2 系列的公共 token）
- User-Agent 随意给个 `Mozilla/5.0` 就行，不加会偶发被拦

## 已知 endpoint

- `GET push2.eastmoney.com/api/qt/clist/get` — 列表 / 排行
  - 必需：`fs`（市场/板块过滤码）、`fields`（字段清单）
  - 可选：`pn`（页码，1-based）、`pz`（每页数量）、`fid`（排序字段）、`po`（0=asc / 1=desc）、`fltt`（2=浮点格式化）、`invt`（2=固定）、`np`（1=固定）
  - 返回：`data.diff[]` 数组
- `GET push2.eastmoney.com/api/qt/ulist.np/get` — 批量报价（给定 secids）
  - 必需：`secids`（逗号拼接的 `<market>.<code>`）、`fields`
  - 返回：`data.diff[]` 数组
- `GET push2.eastmoney.com/api/qt/stock/get` — 单只详情
  - 必需：`secid`、`fields`
- `GET push2his.eastmoney.com/api/qt/stock/kline/get` — K 线历史
  - 必需：`secid`、`klt`（周期：1 分 / 5 / 15 / 30 / 60 / 101 日 / 102 周 / 103 月）、`fqt`（0=不复权 / 1=前复权 / 2=后复权）、`fields1`、`fields2`
  - 返回：`data.klines[]` — CSV 字符串数组
- `GET datacenter-web.eastmoney.com/api/data/v1/get` — 报表类
  - 必需：`reportName`（如 `RPT_DAILYBILLBOARD_DETAILS`）、`columns`、`pageSize`、`pageNumber`、`sortColumns`、`sortTypes`
  - 返回：`result.data[]`
- `GET np-listapi.eastmoney.com/nlist/api/list/get` — 7x24 快讯
  - 必需：`client=web`、`column_id`、`limit`、`last_time`
- `GET np-anotice-stock.eastmoney.com/api/security/ann` — 公司公告
  - 必需：`sr=-1`、`page_size`、`page_index`、`ann_type`、`stock_list`

## 字段

字段代号词典见 `../field-conventions.md` 的 eastmoney 节（`f2 / f3 / f12 / f14 / f62 / f229-f243` 等全集）。

市场前缀、fs 过滤码、secid 格式也都在那里。

## 坑 / 陷阱

1. **`fltt=2` 必传**：否则价格字段是 `int × 10^f152` 的整数表示，要自己除
2. **资金流单位混乱**：`f6` 成交额是元，但 `f62 / f66 / f72 / f78 / f84` 等净流入大部分接口返回"万元"，核对单条接口后再乘
3. **secid vs code**：`0.000001 / 1.600000` 是 secid（market + code），只有纯 code 时要先判断所属市场前缀再拼。用 `clis/eastmoney/_secid.js` 导出的 `resolveSecid(input)`（单股）或 `splitSymbols(s)`（批量参数拆分），不要自己硬拼前缀
4. **港股代码 `00700.HK` 不是 secid**：只有前缀属于 `{0, 1, 105, 106, 107, 116, 100, 90}` 才当 secid
5. **kline CSV 列序**：`fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` 对应 `date,open,close,high,low,volume,turnover,amplitude,changePct,changeAmt,turnoverRate`
6. **datacenter-web 字段名大写**：`SECURITY_CODE` 不是 `security_code`

## 可参考的 adapter

| 模板类型 | 参考文件 |
|---------|---------|
| clist 分页排行 | `clis/eastmoney/convertible.js` / `rank.js` / `etf.js` / `sectors.js` |
| ulist 批量报价 | `clis/eastmoney/quote.js` |
| K 线历史 | `clis/eastmoney/kline.js` |
| 报表类 | `clis/eastmoney/longhu.js` / `holders.js` |
| 7x24 快讯 | `clis/eastmoney/kuaixun.js` |
| 公司公告 | `clis/eastmoney/announcement.js` |
| 指数 / 北上 | `clis/eastmoney/index-board.js` / `northbound.js` |
| 资金流 | `clis/eastmoney/money-flow.js` |

新写 eastmoney adapter 时，照最像的那条 copy + 改 `name` / URL 参数 / 字段映射三处。
