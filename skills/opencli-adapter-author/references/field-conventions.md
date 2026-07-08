# Field Conventions

响应字段代号在主要站点上的解码表。写 adapter 前先查一遍，查不到再用 SKILL.md 里 Step 2 的实测法推出来，推完补到本表。

---

## eastmoney（东方财富）

域名：`push2.eastmoney.com` / `push2his.eastmoney.com` / `datacenter-web.eastmoney.com` / `np-listapi.eastmoney.com` / `np-anotice-stock.eastmoney.com`

### 通用行情字段（`push2` clist/ulist/stock）

| 代号 | 含义 | 备注 |
|------|------|------|
| `f1`  | 精度位数 | `fltt=2` 后可忽略 |
| `f2`  | 最新价 | 要 `fltt=2` 才是格式化浮点 |
| `f3`  | 涨跌幅 % | 同上 |
| `f4`  | 涨跌额 | 同上 |
| `f5`  | 成交量（手） | |
| `f6`  | 成交额（元） | 接口默认是"元"，个别接口是"万元"，看 `f152` |
| `f7`  | 振幅 % | |
| `f8`  | 换手率 % | |
| `f9`  | 市盈率（动态） | |
| `f10` | 量比 | |
| `f12` | 代码 | 股票/债券/ETF/指数统一 |
| `f13` | market | 数字市场代号，见下表 |
| `f14` | 名称 | |
| `f15` | 最高 | |
| `f16` | 最低 | |
| `f17` | 今开 | |
| `f18` | 昨收 | |
| `f20` | 总市值 | |
| `f21` | 流通市值 | |
| `f23` | 市净率 | |
| `f62` | 主力净流入 | **单位是"元"**，但有的接口返回"万元"，要核对 |
| `f66` | 超大单净流入 | 同上 |
| `f72` | 大单净流入 | |
| `f78` | 中单净流入 | |
| `f84` | 小单净流入 | |
| `f100` | 所属板块 | |
| `f152` | 精度（当 `fltt` 不传时要除以 10^f152） | 所以一律 `fltt=2` |

### Convertible bond（可转债）专属

| 代号 | 含义 |
|------|------|
| `f229` | 正股价 |
| `f230` | 正股涨跌幅 |
| `f232` | 正股代码 |
| `f234` | 正股名称 |
| `f235` | 转股价 |
| `f236` | 转股价值 |
| `f237` | 转股溢价率 |
| `f238` | 剩余年限 |
| `f239` | 到期收益率 (YTM) |
| `f243` | 上市日期 (YYYYMMDD int) |

### K-line `push2his` stock/kline/get

返回形如 `data.klines: ["2024-01-02,10.5,10.8,10.9,10.4,12345,..."]` 的 CSV 字符串数组。用 `fields1 / fields2` 控制列。典型列序：

```
date, open, close, high, low, volume, turnover, amplitude, changePct, changeAmt, turnoverRate
```

### Market 前缀（secid 格式 `<market>.<code>`）

| 前缀 | 市场 |
|------|------|
| `1.`   | Shanghai (SSE) |
| `0.`   | Shenzhen (SZSE) + Beijing (BSE) |
| `116.` | Hong Kong (HKEX) |
| `105.` | NASDAQ |
| `106.` | NYSE |
| `107.` | AMEX |
| `100.` | 指数（HSI / SPX / DJIA / 各板块指数） |

判断 symbol 是否已经是 secid 时，只在数字前缀属于上表时才认，否则视作普通 code（防止 `00700.HK` 这种 `<digits>.<alpha>` 误判）。

### fs 市场/板块过滤码

| 代码 | 含义 |
|------|------|
| `m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048` | 沪深 A 股全集 |
| `m:1+t:2,m:1+t:23` | 沪 A |
| `m:0+t:6,m:0+t:80` | 深 A |
| `m:0+t:81+s:2048` | 北证 A |
| `m:0+t:80` | 创业板 |
| `m:1+t:23` | 科创板 |
| `m:116+t:3,m:116+t:4,m:116+t:1,m:116+t:2` | 港股 |
| `m:105,m:106,m:107` | 美股 |
| `b:MK0021` | ETF |
| `b:MK0354` | 可转债 |
| `m:90+t:2` | 行业板块 |
| `m:90+t:3` | 概念板块 |
| `m:90+t:1` | 地域板块 |

### datacenter-web 报表 `reportName`

| 名称 | 内容 |
|------|------|
| `RPT_DAILYBILLBOARD_DETAILS` | 龙虎榜 |
| `RPT_F10_EH_FREEHOLDERS`     | 十大流通股东 |

---

## xueqiu（雪球）

域名：`stock.xueqiu.com` / `xueqiu.com`

行情 API 返回字段是人类可读，不需要词典：

| 字段 | 含义 |
|------|------|
| `symbol` | SH600000 / 00700 / AAPL 样式 |
| `name` | 名称 |
| `current` | 最新价 |
| `chg` | 涨跌额 |
| `percent` | 涨跌幅 % |
| `volume` | 成交量 |
| `amount` | 成交额 |
| `high52w / low52w` | 52 周高低 |
| `market_capital` | 总市值 |
| `pe_ttm` | 市盈率 TTM |
| `pb` | 市净率 |

鉴权：需要 `xq_a_token` cookie。走 `Strategy.COOKIE + browser: true`。

---

## bilibili

域名：`api.bilibili.com` / `space.bilibili.com` / `passport.bilibili.com`

B 站接口字段也大多人类可读。关键坑是 **wbi 签名**：

- 凡 URL 含 `/wbi/` 的接口都需要 `w_rid + wts` 签名
- 签名算法依赖每日轮换的 `img_key + sub_key`（从 `nav` 接口拿）
- 平台 SDK 在 `clis/bilibili/utils.js`：`apiGet(page, path, { signed: true, params })` 自动签
- 普通 cookie JSON 接口优先用 `page.fetchJson(url)`

| 字段 | 含义 |
|------|------|
| `mid` | 用户 UID |
| `aid / bvid` | 视频 ID（av 号 / bv 号） |
| `cid` | 视频分 P ID |
| `uname / upname` | up 主昵称 |
| `view / danmaku / reply / favorite / coin / share / like` | 各类计数 |
| `pubdate / ctime` | 发布/创建时间（秒级 unix） |

---

## tonghuashun（同花顺）

域名：`q.10jqka.com.cn` / `d.10jqka.com.cn` / `data.10jqka.com.cn`

同花顺多数接口返回 HTML 表格，需要 DOM 解析。JSONP 接口要设 `Referer: http://q.10jqka.com.cn/`，否则返回空。

| 字段（API） | 含义 |
|------|------|
| `openPrice / closePrice` | 开/收盘 |
| `zdf` | 涨跌幅 % |
| `hsl` | 换手率 |
| `zf`  | 振幅 |

---

## 字段不在词典时

看 `field-decode-playbook.md`。里面是标准 SOP（排序键对比、结构差分、精度排查），10 分钟能推一条。

推完一个代号补回本文件，下次直接查。
