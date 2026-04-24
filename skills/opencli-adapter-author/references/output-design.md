# Output Design

adapter 的 `columns` 不是随便列。要让下游（用户、其他 adapter 合并、agent 后续分析）都能直接读。

---

## 核心约定

### 1. 命名

**camelCase，全英文**：

| 好 | 差 |
|----|---|
| `marketCap` | `market_cap` / `市值` / `MarketCap` |
| `change24hPct` | `change_percentage_24h` / `涨跌幅24h` / `changePct_24h` |
| `bondCode` | `bond_code` / `BOND_CODE` |
| `pubTime` | `publish_time` / `pubdate` |

原则：
- 缩写：`pct`（百分比）/ `pe`（市盈率）/ `pb`（市净率）/ `ytm`（到期收益率）/ `id`
- 时间后缀：`Time`（具体时刻）/ `Date`（日期）/ `Ts`（unix 秒）
- 百分比一律 `Pct` 结尾，数值是"已乘 100"形式（`2.5` 表示 2.5%，不是 `0.025`）
- 数量后缀：`Count`（整数计数）/ `Total`（累计值）

### 2. 类型

| 字段类 | JS 类型 | 格式 |
|--------|---------|------|
| 价格 / 金额 | `number` | 原始小数，别除 1000 别取整 |
| 百分比 | `number` | 已 × 100（`2.5` = 2.5%） |
| 计数 / rank | `number` | 正整数 |
| 代码 / id / symbol | `string` | 股票代码 `'600000'` 保留前导 0 |
| 名称 / 标题 | `string` | 去首尾空白 |
| 时间 | `string` ISO（`'2024-01-15T10:30:00Z'`）或 `number` unix 秒 | 不要本地字符串 `'2024/1/15'` |
| 布尔 | `boolean` | 不用 `0/1` |
| URL | `string` | 绝对路径，相对路径要拼 host |

**特殊**：
- 缺失用 `null`，不用 `0` / `''`（0 和空字符串有业务含义，别混）
- 枚举 → string，不要 int 代号（`'listed'` 比 `0` 清楚）

### 3. 顺序

固定三段：

```
[识别列 ...] [业务数字 ...] [metadata ...]
```

**识别列**（前 1-3 列）：`rank / symbol / code / bondCode / name / title / id`

**业务数字**（中间）：价格、涨跌幅、成交量、市值等业务语义

**metadata**（最后 1-3 列）：`pubTime / updateTime / source / url`

### 4. 必有列（按类型）

| adapter 类型 | 必须包含 |
|-------------|---------|
| 排行 / 列表 | `rank` + 识别列 + 业务数字 |
| 时序 / K 线 | `date`（或 `ts`）+ 数值 |
| 详情（单对象） | 识别列 + 业务字段 |
| 新闻 / 公告 | `title` + `pubTime` + `url` |

### 5. 控量

**单条 ≤ 15 列**。超了就得考虑：
- 拆成多个 adapter（列表版 + 详情版）
- 次要字段合进 `extras: {...}` 对象
- 只有少数用户关心的字段默认隐藏（靠参数开关）

---

## 对齐邻居 adapter

写新 adapter 前先看同站点现有 adapter 怎么命名：

```bash
grep -h "columns:" clis/<site>/*.js
```

复用同类列名。比如 `clis/eastmoney/convertible.js` 用 `bondCode / bondName / stockCode / stockName`，新写 eastmoney 某个涉及股票代码的 adapter 就沿用 `stockCode / stockName`，不要发明 `securityId / securityName`。

---

## 常见错误

| 错 | 对 |
|----|---|
| `columns: ['id', 'name', 'data.price']`（点路径） | 把 `data.price` 在 func 里打平成 `price` |
| `{date: '2024-01-15 10:30'}`（空格 + 非 ISO） | `'2024-01-15T10:30:00Z'` 或 `Date.toISOString()` |
| `{pct: '2.5%'}`（字符串 + 单位） | `{changePct: 2.5}` 纯数字 |
| `{volume: '1.2万'}` | `{volume: 12000}` |
| `{code: 600000}`（整数丢前导 0） | `{code: '600000'}` string，或 `String(code).padStart(6, '0')` |
| columns 和 func 返回的 keys 对不上 | 列出的每个 key 必须在返回对象里，顺序也一致 |

---

## description 字段

adapter `description` 是用户第一眼看到的，写清楚：

1. **数据是什么**：`"A 股涨幅排行"` vs `"大盘指数分时"`
2. **默认行为**：`"默认按涨幅排序，前 20 条"`
3. **重要参数**：`"支持 market 参数切换沪深/北证"`

不要：
- `"get data"` — 废话
- `"查询 xxx 数据"` — 也是废话
- 塞完整 URL / 字段代号列表 — 留给 help

一行 30 字左右够了。

---

## args 命名

- `limit` 而不是 `count / num / n / size`
- `sort` 而不是 `sort_by / order_by / sortKey`
- `market` 而不是 `exchange / platform / type`
- `symbol` / `code` / `query` 根据业务选，保持和邻居 adapter 一致
- 布尔参数用 `enableX / includeX`，默认 false 免得用户改变认知负担

`help` 文案给**所有合法值**，别让用户猜：

```javascript
{ name: 'sort', type: 'string', default: 'turnover', help: '排序：turnover / change / drop / price / premium' }
```

---

## 示例对比

**差的**：

```javascript
columns: ['股票代码', 'name', 'PRICE', 'change%', 'vol', 'time']
```

问题：中英混、大小写乱、百分号字符串、缩写不统一。

**好的**：

```javascript
columns: ['rank', 'stockCode', 'stockName', 'price', 'changePct', 'volume', 'updateTime']
```

识别列在前，metadata 在后，命名统一 camelCase。
