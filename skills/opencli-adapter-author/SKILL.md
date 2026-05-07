---
name: opencli-adapter-author
description: Use when writing an OpenCLI adapter for a new site or adding a new command to an existing site. Guides end-to-end from first recon through field decoding, adapter coding, and verify. Replaces opencli-oneshot / opencli-explorer. For ad-hoc browser driving (no adapter), see opencli-browser instead; for a top-level orientation to opencli, see opencli-usage.
allowed-tools: Bash(opencli:*), Read, Edit, Write, Grep
---

# opencli-adapter-author

你是要给一个站点写 adapter 的 agent。这份 skill 目标：**从零到通过 `opencli browser verify` 的 30 分钟内闭环**。

全程用现有工具：`opencli browser *` / `opencli doctor` / `opencli browser init` / `opencli browser verify`。没有新命令。

调试浏览器型 adapter 时，优先直接带上 `--trace on --live --focus`。`--trace on` 每轮都落 trace artifact，`summary.md` 是失败/成功复盘入口；`--live --focus` 让 automation lease 保留且容器在前台，方便核对最终页面状态。

---

## 前置：看你落在哪

先拿 `coverage-matrix.md` 快速自测。三个问题：

1. 数据在浏览器里看得到吗？（否 → 先解决鉴权）
2. 数据是 HTTP/JSON/HTML 吗？（否 → 不在 skill 范围）
3. 需要实时推送吗？（是 → 找同数据 HTTP 接口；没有就放弃）

三个都 yes 继续。

---

## 顶层决策树

```
START
  │
  ▼
┌──────────────────────────┐
│ opencli doctor 通？      │── no ──→ 修桥接（doctor 输出里的提示）
└──────────────────────────┘
  │ yes
  ▼
┌────────────────────────────────────────────────────┐
│ 读站点记忆：                                        │
│   1. ~/.opencli/sites/<site>/endpoints.json         │
│   2. ~/.opencli/sites/<site>/notes.md               │
│   3. references/site-memory/<site>.md               │
└────────────────────────────────────────────────────┘
  │ 命中 endpoint + 字段 → 直接跳到【endpoint 验证】（不跳写 adapter！memory 可能过期）
  │ 没命中 → 继续
  ▼
┌──────────────────────────┐
│ 站点侦察（site-recon）    │  → Pattern A/B/C/D/E
└──────────────────────────┘
  │
  ▼
┌──────────────────────────┐
│ API 发现（api-discovery）│  §1 network → §2 state → §3 bundle → §4 token → §5 intercept
└──────────────────────────┘
  │ 拿到候选 endpoint
  ▼
┌────────────────────────────────────────────┐
│ 直接 fetch 验证 endpoint（memory 命中也要跑）│── 401/403 ──→ 回到 §4 排 token
│ 数据非空 + 200                              │── 空/HTML ──→ 回到 site-recon 换 Pattern
│ memory 里的值还活着吗？                     │── 站点换版 ──→ 标记旧 endpoint，回 api-discovery
└────────────────────────────────────────────┘
  │ OK
  ▼
┌───────────────────────────────────────┐
│ 字段解码（memory 里的 field-map 也要抽查）│  自解释 → 直接 / 已知代号 → field-conventions / 未知 → decode-playbook
│ 比一条已知字段和网页肉眼值，确认没错位     │
└───────────────────────────────────────┘
  │
  ▼
┌──────────────────────────┐
│ 设计 columns (output)    │  对照 output-design.md 的命名 / 类型 / 顺序
└──────────────────────────┘
  │
  ▼
┌──────────────────────────┐
│ opencli browser init      │  生成 ~/.opencli/clis/<site>/<name>.js 骨架
│ 复制最像的邻居 adapter    │
│ 改 name / URL / 映射三处  │
└──────────────────────────┘
  │
  ▼
┌──────────────────────────┐
│ opencli browser verify    │── 失败 ──→ autofix skill，用 --trace retain-on-failure 回对应步骤
└──────────────────────────┘
  │ 成功
  ▼
┌──────────────────────────┐
│ 字段 vs 网页肉眼对一遍   │── 数值不对 ──→ 回字段解码
└──────────────────────────┘
  │ 对得上
  ▼
┌──────────────────────────┐
│ 回写 ~/.opencli/sites/   │  endpoints / field-map / notes / fixtures
└──────────────────────────┘
  │
  ▼
DONE
```

---

## Runbook（一步一步勾选）

```
[ ] 1. opencli doctor 返回 "Everything looks good"
[ ] 2. 读站点记忆：
       [ ] ~/.opencli/sites/<site>/endpoints.json 存在？里面有想要的 endpoint？
       [ ] references/site-memory/<site>.md 存在？看"已知 endpoint"节
       [ ] 命中后：**跳到第 5（endpoint 验证） + 第 7（字段核对）**，不能直接跳第 9 写 adapter
       [ ] memory 写入超过 30 天（看 `verified_at`）→ 当作过期，按冷启动走 Step 3 → 4
[ ] 3. 侦察（site-recon.md）：
       [ ] **首选**：`opencli browser analyze <url>` 一步拿 pattern + 反爬 + 最近 adapter + next step
       [ ] `analyze` 结论模糊时再手跑：`open` → `wait time 2` (或 `wait xhr <regex>`) → `network`
       [ ] 定 Pattern（A / B / C / D / E）
[ ] 4. API 发现（api-discovery.md）按 Pattern 选 §：
       [ ] Pattern A → §1 network 精读
       [ ] Pattern B → §2 state 抽取 + §1 深层数据
       [ ] Pattern C → §3 bundle / script src 搜索
       [ ] Pattern D → §4 token 来源 + 降级 §5
       [ ] Pattern E → 找 HTTP 轮询接口；找不到才 §5
[ ] 5. 直接 fetch 候选 endpoint 验证：
       [ ] 返回 200
       [ ] 响应含目标数据（不是 HTML / 广告）
[ ] 6. 定鉴权策略：裸 fetch 通 → PUBLIC；要 cookie / token / csrf → COOKIE；拿不到签名 → INTERCEPT；只能点 UI → UI
[ ] 7. 字段解码：
       [ ] 自解释 → 直接用 key
       [ ] 已知代号 → field-conventions.md 查表
       [ ] 未知代号 → field-decode-playbook.md（排序键对比 / 结构差分 / 常量排查）
[ ] 8. 设计 columns（output-design.md）：
       [ ] 命名 camelCase 且对齐邻居 adapter
       [ ] 类型 / 单位 / 百分比格式清楚
       [ ] 顺序：识别列 → 业务数字 → metadata
[ ] 9. 写 adapter（adapter-template.md）：
       [ ] opencli browser init <site>/<name>
       [ ] 找同站点或同类型最像的 adapter，cp 过来
       [ ] 改 name / URL / 字段映射
[ ] 10. opencli browser verify <site>/<name>
        [ ] 首轮通过后立刻 `--write-fixture` 生成 `~/.opencli/sites/<site>/verify/<cmd>.json` 种子
        [ ] 手改种子：加 `patterns`（URL / 日期 / ID 格式）+ `notEmpty`（核心字段）+ 收紧 `rowCount`
        [ ] 再跑一次 `opencli browser verify <site>/<name>`，确认 ✓ matches fixture
[ ] 11. 字段值 vs 网页肉眼比对（别只看 "Adapter works!"）
[ ] 12. 回写站点记忆（**verify 通过 + 肉眼比对对得上之后**，schema 见 `references/site-memory.md`）：
        [ ] `endpoints.json`：以 endpoint 的短名为 key，value = `{url, method, params.{required,optional}, response, verified_at: YYYY-MM-DD, notes}`
        [ ] `field-map.json`：只追加新代号。key = 字段代号，value = `{meaning, verified_at: YYYY-MM-DD, source}`；**已存在的 key 不要覆盖**，有冲突先和网页肉眼值对齐再写
        [ ] `notes.md`：顶部追加一段 `## YYYY-MM-DD by <agent/user>`，写本次写 adapter 时遇到的新坑 / 新结论
        [ ] `verify/<cmd>.json`：**必填。** `opencli browser verify` 的期望值（args / rowCount / columns / types / patterns / notEmpty），Step 10 已经让你生成了，这里只是 checklist
        [ ] `fixtures/<cmd>-<YYYYMMDDHHMM>.json`：存一份该 endpoint 的完整响应样本（去掉 cookie / token / 用户私有字段再存），给后续字段对比 / 离线 replay 用
        [ ] 调试过程中如果在 repo / adapter 目录 dump 过临时文件（`.dbg-*.html` / `raw-*.json` / 等），**在 commit 前清干净**——这些本来就该落在 `~/.opencli/sites/<site>/fixtures/` 或 `/tmp/`
```

---

## 降级路径（某步卡住跳到哪）

| 卡在 | 现象 | 跳去 |
|------|------|-----|
| Step 4 API 发现 | `network` 空，`__INITIAL_STATE__` 也空 | §3 bundle 搜 baseURL |
| | bundle 搜不到 baseURL | §5 intercept |
| Step 5 endpoint 验证 | 401 / 403 | §4 token 排查 |
| | 200 但响应是 HTML | 回 Step 3 换 Pattern 判断 |
| | 200 但 `data: []` 空 | 参数传错 / 接口换版，回 §1 看 network 里真实请求头 |
| Step 7 字段解码 | 排序键对比推不出 | field-decode-playbook.md §3 结构差分 |
| | 还推不出 | 先输出 raw，adapter 跑起来再迭代 |
| Step 10 verify 失败 | `fltt` 漏了 / 字段映射错 | autofix skill；复现命令加 `--trace retain-on-failure` |
| | 某列永远是 `null` | 字段路径错了，回 Step 7 |
| Step 10 verify fixture mismatch | `[pattern]` row[i] 报错 | 先肉眼比对网页值；值对 → 是 fixture pattern 太严，放宽；值不对 → 字段映射错 |
| | `[column] missing column "X"` | 实际 response 没这列（站点改版 or args 影响）；重新 `--update-fixture` 或修 adapter |
| | `[type]` actual null / undefined | 字段提取失败，回 Step 7 重抽；临时 fallback 用 union type `string\|null` 只有在语义真的可空时用 |
| Step 11 数值不对 | 差 10000 倍 | 单位不统一（"万" vs "元"） |
| | 百分比小 100 倍 | 响应已是 `0.025`，不要 × 100 |

---

## 参考文件

| 文件 | 什么时候翻 |
|------|----------|
| `references/coverage-matrix.md` | 动手前做"是否在范围内"自测 |
| `references/site-recon.md` | Step 3 定站点类型 |
| `references/api-discovery.md` | Step 4 找 endpoint |
| `references/field-conventions.md` | Step 7 查已知字段代号 |
| `references/field-decode-playbook.md` | Step 7 字段不在词典时 |
| `references/output-design.md` | Step 8 命名 / 类型 / 顺序 |
| `references/adapter-template.md` | Step 9 文件结构 + 活例子 `convertible.js` |
| `references/site-memory.md` | 总览：in-repo 种子 + 本地 `~/.opencli/sites/` 的两层结构 |
| `references/site-memory/<site>.md` | Step 2 读站点公共知识（eastmoney / xueqiu / bilibili / tonghuashun 已铺） |
| `references/success-rate-pitfalls.md` | Step 7 / 11 踩坑前翻：10 种"verify 能过但数据是错的"静默失败 |
| `references/jsdom-fixture-pattern.md` | 当 adapter 走 `page.evaluate` 内 DOM 抽取、且 mocked-evaluate 单测漏 silent bug 时——把 HTML 冻进 `clis/<site>/__fixtures__/` 用 JSDOM 跑（含 fixture 创建 mandatory `awk 'NF>0'` 收紧 + reverse-validate 纪律） |
| `references/typed-errors.md` | 写 `func` 主体之前必读：5 类 typed error 落点表（ArgumentError / EmptyResultError / CommandExecutionError / AuthRequiredError / TimeoutError）+ 三大 silent anti-pattern（silent-clamp / sentinel-row / generic CliError）的反例修法 |

---

## 关键约定

- adapter 只引 `@jackwener/opencli/registry` + `@jackwener/opencli/errors`，不用第三方
- `columns` 数组和 `func` 返回对象 keys 完全对齐（含顺序）
- **中间解析对象 key 不能跟 `columns` 任一项重叠**（否则 silent-column-drop audit 误判，PR #1329 R1 真踩过；改成专属命名 + push row 时 destructure aliasing）
- **`browser:` field 决定 func 签名**：`browser:false → (args)`，`browser:true → (page, args)`。搞反时 `args` 实际是 debug flag，所有外部参数 silent fallback 到 default（PR #1329 upstream 之前 8 个 non-browser adapter 全踩过这个）
- 已知失败按 [`references/typed-errors.md`](./references/typed-errors.md) 5-classification 抛对应 typed error；**不要** silent `return []`，**不要** silent `return [{sentinel}]`，**不要** `Math.max/min` silent clamp 外部参数
- 写私人 adapter 用 `~/.opencli/clis/<site>/<name>.js`（免 build）；要提 PR 才 copy 到 `clis/<site>/<name>.js`
- 站点记忆每轮回写：没记忆 → 用 skill → 产生记忆 → 下次变 5 分钟
- **调试过程中的原始 dump / 抓包 / HTML 样本只能落在 `~/.opencli/sites/<site>/fixtures/` 或 `/tmp/`。严禁在 repo 根目录、`clis/<site>/` 或当前工作目录留 `.dbg-*.html / raw-*.json / sample.*` 这类临时文件**（PR diff 会带上去，别人 review 时很烦）。
- **JSDOM unit-test fixture（`clis/<site>/__fixtures__/<command>.html`）是上面那条的例外**——它是有意 commit 进 repo 的 review artifact，不是临时 dump。但因此 quality bar 要更高：必须按 `references/jsdom-fixture-pattern.md` 的 5 步做完（含 mandatory `awk 'NF>0'` 空白行收紧），并 reverse-validate 一道证明 regression guard 真能挂。

---

## 卡住了

- 诊断类：`opencli doctor` → 看 `notes.md` → 搜 autofix skill
- 字段解码类：`field-decode-playbook.md` 全三节走完 → 先输出 raw 迭代
- endpoint 找不到：api-discovery §5 intercept 兜底

不要猜。猜错了 verify 能通过但数据是错的，用户看到乱码才发现。
