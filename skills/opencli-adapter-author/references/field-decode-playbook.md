# Field Decode Playbook

响应里出现 `f237 / zdf / oc5 / x4` 这种看不懂的代号时走这套流程。目标：10 分钟内搞定一条未知字段，不靠猜。

适用于 `field-conventions.md` 没收录的站点、没收录的代号、或者收录了但怀疑对不上的情况。

---

## 决策树

```
拿到一条响应，有字段看不懂？
├── 字段值是字符串 / 时间 / URL → 走 §1 「肉眼对网页」
├── 字段值是数字 → 走 §2 「排序键对比法」
├── 字段值是数组 / 对象 → 走 §3 「结构差分法」
└── 改参数响应不动 → 走 §4 「常量 / 精度位排查」
```

---

## §1 肉眼对网页（字符串/时间/URL 类）

最快。打开对应网页，响应的这条记录在哪行，把响应值跟页面上的文字一一对照。

```bash
# 举例：eastmoney convertible，响应里有 f243=20231215，页面上这支债写着"上市日期 2023-12-15"
# 直接判断 f243 是上市日期（YYYYMMDD int）
```

**时间字段的判别**：

| 观察到的形态 | 大概率是 |
|-------------|---------|
| 10 位整数 `1712345678` | unix 秒 |
| 13 位整数 `1712345678000` | unix 毫秒 |
| 8 位整数 `20240101` | YYYYMMDD int |
| 6 位整数 `240101` | YYMMDD int |
| 字符串 `2024-01-01` / `2024/01/01` | ISO 日期 |
| 字符串 `01/01/2024` | 美式日期，小心月日顺序 |

**URL 字段的判别**：

```bash
# 如果是相对路径，拼 domain 回浏览器验证
opencli browser eval "window.location.origin + '/<path>'"
```

---

## §2 排序键对比法（数字类核心手段）

数字字段是最容易踩坑的一类——看起来都是小数，但可能是涨跌幅、换手率、振幅、溢价率、市盈率……单位和量级也可能带陷阱。

### 流程

1. **找到一个能改变排序的参数**

   | 站点 | 排序参数 | 值域 |
   |------|---------|------|
   | eastmoney (push2 clist) | `fid` + `po` | `fid` 是字段代号，`po` 是 `0=asc / 1=desc` |
   | xueqiu | `order_by` | `percent / volume / amount / ...` |
   | bilibili | `order` | `pubdate / click / stow / ...` |
   | tonghuashun | `sort` | 数字代号 |
   | 通用 | 页面点击表头切排序，抓包看新参数 | — |

2. **用两个已知含义的值各抓一份响应**

   比如 eastmoney，`fid=f2`（最新价）和 `fid=f3`（涨跌幅）：

   ```bash
   opencli browser eval "fetch('<url>&fid=f2&po=1').then(r=>r.json()).then(d=>d.data.diff.slice(0,3))"
   opencli browser eval "fetch('<url>&fid=f3&po=1').then(r=>r.json()).then(d=>d.data.diff.slice(0,3))"
   ```

3. **对比两组数据**：

   - 第一条记录的 `symbol/name` 变了吗？没变说明这个参数无效或者白名单窄
   - 新的第一条里，哪个字段数量级 / 正负号 / 小数位数变化最大？那个字段就是和 `fid` 对应的业务语义
   - 单调性：按 `desc` 取前 3 条，看新旧两组里目标字段是不是都单调下降

4. **用第三个参数交叉验证**

   ```bash
   opencli browser eval "fetch('<url>&fid=f6&po=1').then(r=>r.json()).then(d=>d.data.diff.slice(0,3))"  # 成交额
   ```

   对照网页上"成交额排行"的前三名。对得上就认。

### 实例：推 f237（可转债溢价率）

```bash
# 按价格排，拿一条观察
opencli browser eval "fetch('https://push2.eastmoney.com/api/qt/clist/get?fs=b:MK0354&pn=1&pz=1&fid=f2&po=1&fltt=2&fields=f12,f14,f2,f3,f236,f237,f239').then(r=>r.json()).then(d=>d.data.diff[0])"
# 返回 {f12:'123456', f14:'XX转债', f2:180.5, f3:2.1, f236:98.5, f237:83.2, f239:-4.1}

# 按 f237 排
opencli browser eval "fetch('...&fid=f237&po=1...').then(...)"
# 第一条变了，f237 值变成 400+

# 打开 eastmoney 可转债页，切"溢价率"排序，第一条的溢价率确实是 400+ —— f237 就是溢价率 %
```

---

## §3 结构差分法（数组 / 嵌套对象类）

响应顶层是 `{data: {diff: [...]}}` 还是 `{list: [{...}, {...}]}` 还是 `{rows: [{k:v}, ...]}`，不同接口差别大。

### 流程

1. **先数一次嵌套路径**

   ```bash
   opencli browser eval "fetch('<url>').then(r=>r.json()).then(j=>({keys:Object.keys(j), type:Array.isArray(j)?'array':'object'}))"
   ```

2. **一层一层剥**

   ```bash
   opencli browser eval "fetch('<url>').then(r=>r.json()).then(j=>{const d=j.data; return {keys:Object.keys(d), sample: d[Object.keys(d)[0]]}})"
   ```

3. **数数组长度对照 pz / pageSize**

   如果请求 `pz=20` 拿回的数组正好 20，那就是结果数组；如果是 1 那可能是 pagination meta。

4. **同一字段在不同条目间是否变化**

   ```bash
   # 取前三条的 keys，看哪些 key 的值在变（业务数据），哪些不变（常量/配置）
   opencli browser eval "fetch('<url>').then(r=>r.json()).then(d=>d.data.diff.slice(0,3).map(x=>({f2:x.f2,f3:x.f3,f152:x.f152})))"
   ```

---

## §4 常量 / 精度位排查

有的字段每条都一样，是精度指示器或类型标记。

| 典型现象 | 通常含义 | 处理 |
|---------|---------|------|
| 每条值都是 `2` 或 `3` | 精度位数（小数几位） | 除以 `10^n` 还原浮点 |
| 每条值都是 `0` 或 `1` | 涨跌方向 / 停牌标记 | 枚举，查同类 adapter |
| 每条值都是 `6` / `8` / `80` | 市场代号 / 分类 ID | 查 `field-conventions.md` 市场表 |
| 每条值都是空字符串 | 接口不返回但字段有占位 | 请求里去掉 / 用别的字段 |

**eastmoney 精度坑**：不传 `fltt=2` 时，价格字段是 `int * 10^f152`。所以一律加 `fltt=2`，避免所有除法问题。

---

## §5 写完要做的事

推出一个新代号后：

1. **补进 `references/field-conventions.md`**：找到对应站点的表格加一行。下次直接查。
2. **在 adapter 代码里留一条注释**：如果是实测推出来的不常见代号，写一行 `// f237 = convertible premium rate (verified 2026-04-20 against page)` 方便复核。
3. **通过 `opencli browser verify` 验一次**：字段值能对上网页上眼见的数字。

---

## §6 通用坑

| 坑 | 症状 | 解 |
|----|------|-----|
| 单位"万"当"元"用 | 成交额少 4 个零 | eastmoney `f6` 是元、`f62 / f64` 等净流入是万，核对每条接口 |
| 百分比没 × 100 | 涨跌幅显示 0.0XX | 响应已经乘过 100 或者站点用小数 —— 看一眼网页 |
| 股票代码被截 | `600000` 变 `60000` | 某些接口返回 int，前导 0 掉了。永远用 `String(code).padStart(6, '0')` 处理 A 股代码 |
| 时间区无前导 0 | `2024-1-1` 排序坏 | parse 后用 ISO 回写 |
| JSON 里数字是字符串 | 无法 `.toFixed()` | `Number(x)` 显式转 |

---

## §7 真推不出来

三条兜底：

1. **找同站点已有的 adapter** — `ls clis/<site>/` 翻文件，别站点邻居的 adapter 通常共享字段命名
2. **找开源实现** — GitHub 搜 `<域名> fields` 或 `<域名> api`，往往有 Python / Go 库已经解码过
3. **灰度**：把这条字段先输出成 raw，命令仍可用，下一版再语义化

不要猜。猜错了后面验证不到、线上跑出来用户看到乱码也会误导决策。
