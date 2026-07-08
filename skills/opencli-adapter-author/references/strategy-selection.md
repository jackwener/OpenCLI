# Strategy Selection

SKILL.md 顶层已给出 strategy gate 的 enum、表格和必填字段。本文件展开**为什么**这套 ladder 是按"契约"而不是"接口高度"组织的，以及具体怎么用 `opencli browser analyze` 的 `api_candidates` 证据填 strategy note。

进入条件：你已经按 `site-recon.md` 跑过 `opencli browser analyze`、按 `api-discovery.md` 抓过候选 endpoint。本文件是写 note 之前的最后一站。

---

## 1. 核心模型：契约 vs 无契约

普遍假设 "API > DOM" — **数据不支持**。

837 个内置 adapter 在 30 天观察窗（2026-04-20 → 2026-05-20）按 6 档 strategy 分类后的实测 fix 频率：

| Strategy | 契约级别 | fixes/adapter-year | 解读 |
|---|---|---|---|
| `PUBLIC_API` | stable | **1.18** | 一方文档化 API，最稳 |
| `COOKIE_API` | stable | 2.01 | 官方 web 接口 + 用户 cookie |
| `UI_SELECTOR` | visible-ui | 1.92 | DOM 的 a11y / semantic 约定也是契约 |
| `DOM_STATE` | visible-ui | 0.91 (N=11, 小样本) | hydration JSON 半契约 |
| `PAGE_FETCH` | **internal-unstable** | **8.41** | 站内未文档化 endpoint，最易漂 |
| `INTERCEPT` | **internal-unstable** | **8.69** | 拦截内部 XHR，签名/字段 silent drift |

含义：

- 选 `PAGE_FETCH` / `INTERCEPT` 的 adapter 平均维护成本是 `PUBLIC_API` 的 **~7-8 倍**
- `UI_SELECTOR` 在 1.92/year，跟 `COOKIE_API` 同档 — 不是"漂得最快"
- `DOM_STATE` 在 0.91/year 但 N=11 小样本，按 `UI_SELECTOR` 的近邻处理

**Selection bias caveat**：`PAGE_FETCH` / `INTERCEPT` 高 fix 率部分来自 selection bias — 用这俩的本身就是难站（Twitter GraphQL、xhs signed URL）。但这不改变 practical implication：能用契约层就用契约层，别把稳定的 UI/DOM 实现盲目迁到无契约 endpoint。

数据观察窗局限：30 天窗口是近似不是长尾；`PAGE_FETCH`/`INTERCEPT`/`DOM_STATE` 样本量小（N=32/9/11），二期数据足时会单独评估 `DOM_STATE`。

---

## 2. Ladder 心智模型

```
契约层（首选，互相平级，按 surface 适配）：
  PUBLIC_API ─┬─ COOKIE_API ─┬─ UI_SELECTOR ≈ DOM_STATE
              (read)           (write/click/upload)
              
无契约层（被迫才用，必须正向论证 8x 维护成本）：
  PAGE_FETCH ──── INTERCEPT
```

注意：**ladder 不是从上往下降级**。`UI_SELECTOR` 不是 `PUBLIC_API` 失败后的"惩罚选项"。如果数据/操作本来就是 UI 表面的事（publish、click、upload、表单），`UI_SELECTOR` 是首选，不需要为"为什么不是 API"过度辩护。

---

## 3. 怎么把 `api_candidates` 转化为 strategy note 证据

`opencli browser analyze <url>` 的输出里 `api_candidates[]` 字段，每条带：

```json
{
  "url": "https://example.com/api/list",
  "status": 200,
  "contentType": "application/json",
  "real_data_score": 0.82,
  "verdict": "likely_data",
  "reasons": ["json content-type", "non-empty top-level array", "3 business-like keys"],
  "sample_paths": ["$.data.items:array(20)", "$.data.items[0].title:string"]
}
```

按 `verdict` 决策：

| Verdict | 含义 | strategy 信号 |
|---|---|---|
| `likely_data` (score ≥ 0.65) | 看起来是业务数据 | 优先 replay 这条做 `PUBLIC_API` / `COOKIE_API` 候选 |
| `maybe_data` (score 0.35-0.65) | 可能业务数据但有 telemetry / 空字段嫌疑 | replay 必须人工核对字段是不是目标数据 |
| `noise` | analytics / beacon / personalization | 不是 API 候选；Pattern A 不能基于这类条目成立 |
| `blocked` (401/403) | auth-gated | 先排 cookie / token / CSRF，**不要**直接退到 `UI_SELECTOR` |

**关键**：`real_data_score` 是证据，不是 strategy。你最终在 strategy note 里仍要写 replay 出来的 status / content-type / sample shape，不是把 score 直接当结论。

### 反例：booking #1680

```
Site: booking.com (酒店搜索)
analyze 输出：17 个 JSON XHR，原 Pattern A
但 api_candidates 全部 verdict=noise（analytics + personalization + experiment）
```

按 1.0.17 前的旧判定，agent 会按 Pattern A 写 `PAGE_FETCH` adapter，replay 拿到 noise data → adapter silent-fail。**新判定**：`real_data_candidates = 0` → Pattern 落到 C → 提示 SSR HTML scrape → 正确的 strategy 是 `DOM_STATE` / `UI_SELECTOR`。

`browser analyze` 的 `recommended_next_step` 也已更新为 "Inspect api_candidates, then replay the best endpoint" — 不再按 XHR count 推 API。

---

## 4. Strategy note 的关键字段填法

### `Contract` 字段

不是直接从 strategy enum 抄，而是反映"这个 source 有多稳"：

- `stable`：一方文档化 API、官方 web 接口（PUBLIC_API、COOKIE_API）
- `visible-ui`：用户可见的 DOM、a11y / semantic 标记（UI_SELECTOR、DOM_STATE）
- `internal-unstable`：站内未文档化 endpoint、签名 / queryId 漂移、字段 silent rename（PAGE_FETCH、INTERCEPT）

### `Evidence` 三行

每行都是事实，不是猜测：

```md
- observed request/state: GET /api/v2/list (sample_paths: $.data.items:array(20), $.data.items[0].title:string)
- auth source: browser cookie (sessionid)，无 CSRF
- replay result: 200 / application/json / 20 items / 非空
```

`observed request/state` 在 `DOM_STATE` 时写 state global key（`window.__INITIAL_STATE__.feed.items`）；在 `UI_SELECTOR` 时写 selector path 或 a11y locator（`role=list[name="Trending"] > listitem`）。

### `If PAGE_FETCH or INTERCEPT` 三行论证

```md
Why PUBLIC_API / COOKIE_API are unavailable: <因为 a_bogus signature 必须 page runtime 生成 / 公开 API 缺少 since 字段 / 接口仅在登录态曝露但 cookie 透传会触发 anti-bot>
Why UI_SELECTOR / DOM_STATE are not safer: <因为数据是无限滚动 + 增量加载，DOM 一次只能拿 1 屏 / 因为目标是 write action，UI 无对应操作>
Why the maintenance cost is acceptable: <因为业务需求要 raw timeline cursor / 因为已经接受漂时 autofix 流程兜底>
```

**反模式**：

- ❌ "因为 API 比 DOM 高级" — 不是论证，是假设
- ❌ "因为 selector 不可靠" — 数据不支持（UI_SELECTOR 跟 COOKIE_API 同档）
- ❌ "因为我看到 17 XHR" — 不是论证，是 booking #1680 反例

正确论证须基于：endpoint 的**真实**不可达 / 操作语义本质 / 维护成本承担方有明确接收方。

### `If UI_SELECTOR / DOM_STATE`

```md
- semantic anchor: <a11y role / data-testid / framework-stable class>
- typed error path: <selector 失配时抛 EmptyResultError / CommandExecutionError>
```

不需要"why not API"过度辩护。如果你能简短说一句"目标是 publish，没有公开 write API"或"数据在 SSR HTML 直接 inline 了"就够了。

---

## 5. 与其他 reference 的关系

| 文件 | 关系 |
|---|---|
| [`api-discovery.md`](./api-discovery.md) | §1-5 是 endpoint 发现的具体方法。本文件指它，但本文件管"用 endpoint 证据填 strategy note"，那边管"怎么先找到 endpoint" |
| [`site-recon.md`](./site-recon.md) | Pattern A-E 是 site classification。Pattern A 命中 ≠ `PAGE_FETCH` 必然合适 — 还要看 `api_candidates` 是不是 `likely_data` |
| [`coverage-matrix.md`](./coverage-matrix.md) | 鉴权列已对齐 6 档 strategy enum |
| [`adapter-template.md`](./adapter-template.md) | 写代码模板。strategy note 应该在打开 template 之前已经定好 |
| [`success-rate-pitfalls.md`](./success-rate-pitfalls.md) | 11 种 silent failure 模式 — 多数发生在 strategy 选错时（比如把 noise endpoint 当业务数据） |

---

## 6. 反例案例库

### booking #1680 — Pattern A 误判

旧判定按 XHR count 推 Pattern A，实际 17 XHR 全是 analytics / personalization side channel。新 `verdict` 系统能识别为 `noise`，落到 Pattern C → SSR HTML scrape。

### Twitter GraphQL — PAGE_FETCH 高维护成本的典型

`queryId` 每隔 1-2 月漂一次，字段名 silent rename（`legacy.user_screen_name` → `core.user.screen_name`）。30 天 9 个 fix PR。`Why the maintenance cost is acceptable` 的合理论证：业务需要 raw timeline cursor、autofix 流程已接住、fixed 时间窗口可控。

### xiaohongshu signed URL — INTERCEPT 必要场景

`a_bogus` signature 由 page runtime 即时生成，无法在 Node 端复现也不能拷贝 cookie 跨 origin replay。合理 strategy 是 `INTERCEPT`：触发 UI 让页面自己发请求，从 response 取数据。

### weread-official — PUBLIC_API 首选

WeRead 官方 Agent Gateway 有 Bearer auth + 文档化 schema。一方契约 + 不依赖 cookie / 不依赖浏览器 — 最理想的 strategy。维护成本最低。
