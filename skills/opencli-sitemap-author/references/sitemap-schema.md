# Sitemap Schema Reference

详细 schema 规范。`SKILL.md` 给的是 inline 模板，本文件 spec 化字段、约束、validation 规则、跨文件引用格式。

进入条件：先读 `SKILL.md` 拿到 framing（task execution graph for agents）和两层存储模型。本文件展开**怎么写得对**。

## v1.1 changelog（vs v1）

12 patches，按主题分 3 组。验证基础：twitter PoC（12 files / opencli-user）+ hackernews PoC（10 files / opencli-质量官）双站。

**Group 1 — Scope/boundary**（clarifications，不改 format）
1. §1.1 双语 / CJK token-per-char 比 English 高 30-50%，必要时拆 sub-file（不放宽 800）
2. §2.1 `auth_strategy` 取主体不取并集；例外靠 page-level `contract_strength` 区分
3. §2.5 `pitfalls.md` 只 task-executor 级；adapter-internal 坑回 `notes.md`
4. §2.5 pitfall id / trigger / workaround 全部 **task-executor 第一人称**视角
5. §2.4 `apis.md` entry 加 optional `notes:` 字段（GraphQL queryId path 等 meta）
6. §2.2 page `Linked APIs` 收集中可留空，**不要塞 fake id**

**Group 2 — Reuse/compactness**（结构变化）
7. §2.2 + §4 partial 页面语义：`page_id` 以 `_` 前缀 + `url_patterns: []`，跨页通用 UI 抽到 partial
8. §3 action schema 加 Form B compact YAML（~80 token / action vs Form A markdown ~250）
9. §3 drop action-level `verified_at` / `source`，继承文件 frontmatter

**Group 3 — Execution health/anchors**（action-level 语义）
10. §3.3 跨页 UI 原语 action 允许 adapter-first + DOM fallback 在单个 action 内（不强抬到 workflow 层）
11. §3.4 Recovery 加 `adapter_health_update:` directive + skill 实现 health 写回闭环
12. §2.2 `testid` 标 optional；`selector_pattern` 一等 anchor + 列 5 种合法形态 + 禁 `nth-child` / 单 class / 文案 selector

详细内容见各 section。

---

## 1. 文件层约束

### 1.1 大小约束（agent token budget）

**每个 .md 文件 body ≤ 800 token**（不含 frontmatter）。超过必须拆。

理由：agent 用 sitemap 是 lazy load 模式，只读"当前 page + 当前 workflow + 必要 pitfalls"。单文件大 → agent context 被沉默打爆，特别是 compaction 之后 re-load 时。

实操：
- 一个 page 有 > 8 个 action → 拆 `pages/<page>/index.md` + `pages/<page>/actions/<group>.md`
- 一个 workflow 步骤多 → 拆主线 + `workflows/<task>/sub/<step>.md`
- **双语 / CJK 内容 token-per-char 比 English 高 30-50%**：CJK 单字 ~0.7-1 token，加上术语混排实测一个 1.5KB 中文 markdown 文件就 ~1000 token。**必要时拆 sub-file 而非放宽 800 限制** — 软 target 必然漂，一年后会变 3000，lazy load 失效

### 1.2 Frontmatter（每文件必填）

```yaml
---
schema_version: 1
last_verified: 2026-06-02       # YYYY-MM-DD
source: local | global          # 标识所在存储层
---
```

字段 `schema_version` 用于未来 schema 迁移（v2 引入新字段时旧文件能识别）。

---

## 2. 文件类型 schema

### 2.1 `SITE.md`

```yaml
---
schema_version: 1
site: twitter.com
last_verified: 2026-06-02
source: global
login_required: true
auth_strategy: COOKIE_API   # 引用 strategy-selection.md ladder
---

## Overview
<1-2 句站点定位，agent 看一眼就知道这是什么站>

## Top-level routes
<URL pattern → page_id 映射，只列主干>
- / → pages/home.md
- /<user> → pages/profile.md
- /search → pages/search.md

## Common goals
<主要 user task → workflow 映射>
- publish a post → workflows/publish.md
- find user → workflows/search-user.md
- export data → workflows/export.md

## Site-wide pitfalls
<跨页通用坑，详细见 pitfalls.md>
- requires login for most reads
- "Latest" tab is time-sorted; "For You" is personalized
```

**Required**: `Overview`, `Top-level routes`, `Common goals`
**Optional**: `Site-wide pitfalls` (引用即可)
**Frontmatter required**: `site`, `login_required`, `auth_strategy`

`auth_strategy` 取值：`PUBLIC_API | COOKIE_API | PAGE_FETCH | INTERCEPT | DOM_STATE | UI_SELECTOR`，定义见 [`../../opencli-adapter-author/references/strategy-selection.md`](../../opencli-adapter-author/references/strategy-selection.md)。

**取主体不取并集**：`auth_strategy` 单值，覆盖该站绝大多数请求的策略。少数例外（如 twitter 公开 profile 可裸 fetch，主体仍是 COOKIE_API）在对应 page 的 `Linked APIs` section 里逐条标 `contract_strength` 区分，不靠 frontmatter 表达。array form 加复杂度无收益。

### 2.2 `pages/<page-id>.md`

```yaml
---
schema_version: 1
page_id: home
url_patterns:
  - https://twitter.com/home
  - https://twitter.com/i/timeline
purpose: main feed surface
last_verified: 2026-06-02
source: local
---

## Visual anchors
<agent 用什么 anchor 确认"我在这页">
- a11y: role=main, name="Home timeline"
- text: "What's happening?" (compose prompt)
- pattern: feed items have role=article
- testid: [data-testid="primaryColumn"]   # optional - 新站常用，老站可省
- selector_pattern: tr.athing + tr.subtext  # optional - structural / attribute selector，无 testid 的老站常用

## Actions on this page
<可执行 action，按 stable id 命名>

### action:open_compose
（详见下面 §3 Action schema）

### action:scroll_for_more
...

## Linked APIs
<本页面触发的 endpoint id 列表，不复制 endpoint 内容>
- endpoint_id: timeline_v2
  triggers_on: page load + infinite scroll
- endpoint_id: notifications_count
  triggers_on: page load (silent poll)

## Page-specific pitfalls
<只列本页独有坑>
- compose dialog can be obscured by toast notifications
```

**Required**: `Visual anchors`, `Actions on this page`
**Optional**: `Linked APIs` (建议放，引用 `apis.md` 已注册的 endpoint id), `Page-specific pitfalls`
**Frontmatter required**: `page_id`, `url_patterns` (array), `purpose`

`page_id` 必须 stable — 不依赖 URL params / locale / A/B variant。命名建议 `home / search / profile / compose / settings` 这类语义化。

#### Visual anchors 类型（5 种）

| 类型 | 何时用 | 例 |
|---|---|---|
| `a11y` | 现代站，role + name 稳定的 | `role=button name="Post"` |
| `text` | 站点文案不漂的（少见，i18n 风险）| `"What's happening?"` |
| `pattern` | 多元素重复模式 | `feed items have role=article` |
| `testid` | **Optional** — 新站约定 `data-testid="..."` 的（Twitter / React 系新站常见）| `[data-testid="tweetTextarea_0"]` |
| `selector_pattern` | **Optional, 但旧站必填**：structural / attribute selector，无 testid 时的稳定 fallback | `tr.athing[id="<id>"] + tr` |

`testid` 不存在的老站（HackerNews / 论坛系 / 政府站）`selector_pattern` 是一等 anchor 类型，不视为降级。a11y + selector_pattern 组合通常比 text 更稳。

`selector_pattern` 的合法形态（按稳定性降序）：

| 形态 | 例 | 何时用 |
|---|---|---|
| **id-anchored** | `tr.athing[id="<id>"]` | 元素有 stable id（HN story / DOM-stable comment 行） |
| **sibling traversal** | `tr.athing + tr.subtext`, `~ a.morelink` | 元素本身无 stable handle，但 sibling 关系稳定 |
| **attribute boundary** | `a[href^="item?id="]`, `a[href*="/status/"]` | 元素靠 URL pattern 区分（HN comments link / Twitter status link） |
| **form name** | `input[name="title"]`, `textarea[name="text"]` | 老式 form，`name` attribute 几乎不漂 |
| **ARIA** | `[role="article"]`, `[aria-label*="..."]` | semantic 锚点，跟 `a11y` 重叠但当 a11y 不够时 selector form 仍可作 anchor |

**Discouraged**（高危 anchor）：

- ❌ `tr.athing:nth-child(<rank>)` — rank ↔ nth-child 在多 row 模式下不等价（HN athing + subtext 双 row 就破了）
- ❌ 单 class 抓（`.tweet`）— 同 class 多元素时点错
- ❌ 文案 selector（`a:contains("Post")`）— i18n / rebrand 漂

这些会触发 "verify 通过但点错 element" silent failure，**禁止**作为 stable anchor。

#### `Linked APIs` 可留空

`Linked APIs` 引用的 `endpoint_id` 必须存在于 `apis.md`（间接也在 `endpoints.json`）。如果该站 `endpoints.json` 还在收集中（如 twitter 32+ GraphQL operation 大部分没登记），page `Linked APIs` 留空合理，**不要塞 fake id 占位**。后续 adapter-author 补 `endpoints.json` 后再回填。

#### Partial 页面（跨页通用 UI）

跨页通用 UI（如 tweet card 在 home / profile / status / notifications / bookmarks 都出现）抽到 partial 文件：

- `page_id` 前缀 `_`（如 `_tweet_card`）标识为 partial
- `url_patterns: []`（空数组，表示无独立 URL）
- 其他 page 通过 `action:<id> in pages/_tweet_card.md` reference 这里的 action
- partial 文件不算独立 page，但 schema 字段结构跟正常 page 一样

避免在多 page 复制相同 action，违反 SoT；也避免 arbitrary 把跨页 UI 塞给某个具体 page "拥有"。

### 2.3 `workflows/<task-id>.md`

```yaml
---
schema_version: 1
workflow_id: publish-post
intent: publish a public post (text only)
last_verified: 2026-06-02
source: global
---

## Goal
<user-facing 描述，agent 用来匹配 user intent>
Create a new public post on this site with text content.

## State signature
<workflow 级 checkpoint，re-entry 时用来定位"走到哪一步了">
- entry: any page on the site, logged in
- success: post visible on author's timeline within 5s

## Best path
adapter: opencli twitter post
adapter_health: healthy        # healthy | suspect | broken
preconditions:
  - logged_in
  - text content ready
estimated_turns: 1

## Fallback path
<adapter 不可用 / unhealthy 时的 browser workflow，引用 action id>
1. From any page → navigate to /home (or use current if already on /home)
2. Use action `open_compose` (see pages/home.md)
3. Type text into compose textarea
4. Use action `submit_post` (see pages/home.md)

estimated_turns: 4

## Avoid
<反模式 — 哪些路径浪费 turn / 触发 modal / 用不稳定 selector>
- Manual clicking when adapter is healthy
- Mobile site path (/m/...) — different DOM structure
- Right-click context menu paths — locale-dependent

## Re-entry checkpoints
<给定 browser state，agent 知道走到 workflow 哪一步>
- on /home, compose dialog NOT visible → start from step 1
- on /home, compose dialog visible → start from step 3
- on /<user>/status/<id>, success indicator → done

## State validation
<完成后怎么验证真的成功>
- timeline shows new post within 5s
- post URL accessible
- post text matches submitted content

## Stale markers
<known drift signals — agent 看到这些应该重新探测而不是相信本 workflow>
- "Post" button text changed (i18n drift)
- compose dialog moved to right sidebar (UI redesign 2026-Q3 rumor)
```

**Required**: `Goal`, `State signature`, `Best path`, `Fallback path`, `Avoid`
**Optional but recommended**: `Re-entry checkpoints`, `State validation`, `Stale markers`
**Frontmatter required**: `workflow_id`, `intent`

`adapter_health` enum:
- `healthy`：adapter 30 天内 verified working，无 unresolved fix issue
- `suspect`：adapter 存在但 last_verified 老于 30 天，或最近有 fix PR 还没 merge
- `broken`：adapter 已知 broken，必须走 Fallback path

`adapter_health` 应该周期性 audit 更新（Phase 2 cron）。手写时建议保守标 `suspect`，验证过才标 `healthy`。

### 2.4 `apis.md`

```yaml
---
schema_version: 1
last_verified: 2026-06-02
source: local
---

## Endpoint index

<endpoint_id ↔ trigger 映射，DO NOT 复制 endpoint URL/method/params/response — 那些在 `endpoints.json`>

### endpoint:timeline_v2
- triggers_on_pages: [home]
- triggered_by_actions: [page_load, scroll_for_more]
- contract_strength: internal-unstable
- notes: GraphQL /i/api/graphql/{queryId}/HomeTimeline   # optional - meta 信息（queryId 路径 / 已知 schema 变化）

### endpoint:search_typeahead
- triggers_on_pages: [search]
- triggered_by_actions: [search_input_keystroke]
- contract_strength: internal-unstable

### endpoint:post_create
- triggers_on_pages: [home, compose]
- triggered_by_actions: [submit_post]
- contract_strength: internal-unstable
```

**Required per entry**:
- `endpoint_id` — 必须存在于同站 `~/.opencli/sites/<site>/endpoints.json`
- `triggers_on_pages` — array of `page_id`
- `triggered_by_actions` — array of `action:<stable-id>`
- `contract_strength` — `stable | visible-ui | internal-unstable`，定义见 `strategy-selection.md`

**Optional per entry**:
- `notes` — meta 信息（GraphQL queryId path、已知 schema 变化、特殊 auth 头）。**不要**复制 endpoint URL / method / params / response shape — 那些只在 `endpoints.json`

**Forbidden**:
- Endpoint URL / method / params / response shape（这些只在 `endpoints.json` 单一来源）
- Auth detail（同上）

理由：sitemap 是 navigation layer，endpoints.json 是 API layer。两层各自演进，避免双 stale。

### 2.5 `pitfalls.md`

```yaml
---
schema_version: 1
last_verified: 2026-06-02
source: local
---

## Site-specific pitfalls

### pitfall:login_wall_on_search
trigger: searching without logged-in session
symptom: redirected to /login
workaround: check session before navigating to /search
verified_at: 2026-06-02

### pitfall:infinite_scroll_throttle
trigger: rapid scroll triggers > 5 timeline_v2 fetches
symptom: rate_limit_429 response
workaround: wait 2s between scrolls; or use cursor-based pagination
verified_at: 2026-05-15

### pitfall:locale_button_drift
trigger: site locale is non-English
symptom: hardcoded "Post" / "Submit" text selectors fail
workaround: use a11y role + aria-label instead of visible text
verified_at: 2026-06-01
```

**Required per entry**:
- `pitfall_id` — stable id, **第一人称 task-executor 视角**（"agent 调命令时会撞到" 视角，不是 "实现 adapter 的人会撞到" 视角）
- `trigger` — what causes this，从 task-executor 视角描述（"agent 想做 X 时" 而非 "adapter 实现里有 Y bug"）
- `symptom` — how agent observes the failure
- `workaround` — what to do instead，task-executor 可执行（不是 "修 adapter"）
- `verified_at` — when last seen

#### Scope（避免 sitemap 变杂物间）

`pitfalls.md` 只放 **task-executor 级**坑 — 跑命令 / 操作页面会撞到的坑。**adapter-internal 实现坑**（queryId 解析 / envelope unwrap / bigint id / 字段 silent rename）放在 `~/.opencli/sites/<site>/notes.md`，不进 sitemap。

判断标准：

| 坑的修复者是谁 | 落地 |
|---|---|
| 跑命令的 agent（标 `adapter_health=suspect` / 切 Fallback path / 等 cooldown） | `pitfalls.md`（task-executor 级） |
| 写 adapter 的 agent（改解析逻辑 / 升级 queryId / 改字段路径） | `notes.md`（adapter-internal） |

反例（**不要**写进 pitfalls.md）：

```md
### pitfall:queryid_rotation_breaks_adapter        # ❌ adapter-internal naming
- trigger: adapter 调 cookie-API endpoint，queryId 已 rotation   # ❌ adapter 视角
- workaround: adapter 升级 queryId path                          # ❌ task-executor 做不了
```

正例：

```md
### pitfall:adapter_returns_empty_after_api_drift   # ✅ task-executor naming
- trigger: Best path adapter 返回 typed error 或空 result        # ✅ agent 视角
- workaround: 标 workflow adapter_health=suspect 走 Fallback path # ✅ task-executor 可执行
```

---

## 3. Action Schema（pages 内）

每个 page 的 actions section 包含若干 action 节点。**两种合法 form**，作者按需选：

#### Form A: Markdown 详尽（适合复杂 action / 第一次编写）

```md
### action:<stable-id>

Preconditions:
- <current page / state / auth requirements>

Do:
- <agent action — preferably semantic browser command or existing adapter>

Postconditions:
- <URL / state / output that proves success>

Failure signals:
- <how agent detects this edge no longer works>

Recovery:
- <fallback action / re-state / re-find instruction>
- adapter_health_update: <adapter command> -> suspect    # OPTIONAL — see §3.3

State signature:                          # OPTIONAL — for multi-step internal recovery
  url_pattern: <regex or exact match>
  dom_anchor: <a11y role+name OR semantic selector>

Evidence:
- observed_with: opencli browser <session> <command>
- trace: <path to trace artifact, optional>
```

#### Form B: Compact YAML（首选，~80 token / action vs Markdown ~250）

```yaml
### action:<stable-id>
pre: <current page / state / auth requirements>
do: <agent action, adapter or semantic browser command>
post: <URL / state / output that proves success>
fail: <failure signal 1> | <signal 2> | <signal 3>
recover: <fallback instruction>; adapter_health_update: <adapter> -> suspect
evidence: opencli browser <cmd>
```

字段分隔符约定（避免 ambiguity）：

| 符号 | 用途 | 例 |
|---|---|---|
| `\|` | 多 failure signal 平级枚举（"任一发生即视为失败"）| `fail: button_not_found \| /flow/login redirect` |
| `\|\|` | 多 do path / recovery path **fallback priority**（"前者失败试后者"）| `do: opencli twitter like <url> \|\| click [data-testid="like"]` |
| `;` | 多 recovery 指令 **sequential**（"逐条执行"）| `recover: adapter_health_update: opencli twitter like -> suspect; dom_click within card scope` |

字段语义完全等价 Form A，**推荐 Form B**，密集站避免 verbose markdown 把 page 撑爆。

#### `verified_at` 由文件级 frontmatter `last_verified` 继承

**Form A / B 都不写 action-level `verified_at`** — 文件 frontmatter `last_verified` 已经覆盖该文件所有 action 的最新验证日期。重复写既是冗余又是 drift 源（10 个 action 各自 `verified_at: 2026-06-02` 改时容易漏 1-2 个）。

`source: local | global` 也不在 action 内重复 — 文件位置已隐含。Form A 旧 `Evidence` block 简化为 `observed_with` + optional `trace`，丢 `verified_at` / `source`。

### 3.1 字段说明

**Preconditions**：列出 action 可执行的前置。
- 一般是 page state（"on /home"）+ auth state（"logged_in"）+ UI state（"compose dialog not yet open"）

**Do**：实际操作。优先级：
1. 已有 adapter 命令（`opencli twitter post`）
2. semantic browser command（`opencli browser click "Post" button`）
3. 显式 selector（最后选项，写 stable anchor 不是裸 CSS）

**Postconditions**：成功观察信号。必须具体 — "page changed" 不算，"URL is /compose AND textarea is focused" 才算。

**Failure signals**：哪些观察等同"action 失败 / sitemap 漂"。
- `login_wall_appears`
- `upgrade_modal_opens_instead`
- `button_not_found`
- `URL_does_not_change_within_3s`

**Recovery**：失败时该做什么。
- 链到 fallback path（"use action `mobile_compose` from pages/mobile-home.md"）
- 或回 探测模式（"re-run `find` for 'Post' button with a11y role=button"）
- 可含 `adapter_health_update:` directive（见 §3.3）

**State signature**（OPTIONAL）：用于 action **内部多步骤**的 mid-flight re-entry。
- 简单 action（单 click）不需要
- 复杂 action（"submit form" 包含 type + click + wait）建议加，agent 中断恢复时知道走到哪
- 跟 workflow 级 state signature 区分：workflow signature 是 "走到 workflow 第几步"，action signature 是 "action 内部第几步"

**Evidence**：trust gate — 没 evidence 的 action 不能 promote 到 global。
- `observed_with`：当时跑的命令（用于复现）
- `trace`：optional，对复杂 action 建议附 trace artifact 路径
- `verified_at` 不写在 action 里 — 继承文件 frontmatter `last_verified`
- `source` 不写在 action 里 — 文件位置已隐含

### 3.2 Action id 命名约定

- 动词 + 名词：`open_compose / submit_post / scroll_for_more / dismiss_modal`
- 不要 page-prefix：action 默认作用域是它所在的 page，不要写 `home_open_compose`
- stable：跨 URL params / locale / A/B variant 都应稳定

### 3.3 Action-level adapter-first 模式（跨页 UI 原语）

对**跨页 UI 原语 action**（一般在 partial 里，如 `_tweet_card.md` 的 `like_tweet / repost_tweet / bookmark_tweet`），允许 `Do` 字段写 adapter-first + DOM fallback 二选一，**无需借 workflow 层 Best/Fallback 抬出去**：

```yaml
### action:like_tweet
pre: card visible AND (tweet_url known OR card permalink anchor extractable)
do: opencli twitter like <tweet-url> || click [data-testid="like"] (within card scope)
post: testid 翻转 like -> unlike，icon 红色
fail: testid 不变 | 弹 login modal
recover: adapter_health_update: opencli twitter like -> suspect; dom_click within card scope
evidence: opencli twitter like + opencli browser click
```

两层 routing 不冲突：

- **workflow 层** `Best path / Fallback path` 处理"task 级别"（发推 vs 浏览 vs 搜索）
- **action 层** adapter-first 处理"UI 原语级别"（点 like 按钮）

不要为了 schema 纯粹性把 `like_tweet` 这种**单原子点击但 adapter 比 DOM 稳**的 action 强行抬到 workflow 层 — 那会让"喜欢一条推文"变成一个独立 workflow，跟实际 task 颗粒度脱节。

### 3.4 `adapter_health_update` directive

action `Recovery` 字段可包含 directive：

```
adapter_health_update: <adapter command> -> suspect | broken
```

语义：当**本 action 因为该 adapter 失败而触发 Recovery**时，consumption skill（`opencli-browser-sitemap`）必须：

1. 在 local overlay 找到 reference 该 adapter 的 workflow（一般是 `Best path: adapter: <adapter command>` 的那条）
2. 改写 workflow 的 `adapter_health` 为 directive 指定的等级
3. **下个 agent** 读 workflow 看到 `adapter_health=suspect` → 直接走 Fallback path，不再盲 retry adapter

这是 action 失败的**写侧闭环** — agent 失败后回写健康状态，避免下个 agent 重栽。

不写 directive 时，Recovery 只指导当前 agent 怎么 fallback，不影响其他 agent。带 directive = "我栽了，让我把这事告诉以后的 agent"。

**实现责任**：在 `opencli-browser-sitemap` skill 的 consumption loop 里。Schema 这里只 spec directive 写侧格式，不 spec 实现细节。

**Recovery 回 `healthy` 不在本 schema 范围**：`adapter_health` 从 `suspect` 回 `healthy` 的路径（TTL 自动衰减 / 跑 Fallback 成功后 probe Best path / 人工 reset）留给 `opencli-browser-sitemap` skill spec 拍。本 PR 只定写侧（"failed → suspect"），不定读侧（"suspect → healthy"）的恢复策略。

---

## 4. 跨文件引用

sitemap 内部多文件互相引用。引用格式：

| 引用 | 格式 | 示例 |
|---|---|---|
| 引用 page | `pages/<page-id>.md` | `see pages/home.md` |
| 引用 workflow | `workflows/<task-id>.md` | `see workflows/publish-post.md` |
| 引用 action | `action:<stable-id> in pages/<page>.md` | `use action open_compose in pages/home.md` |
| 引用 partial action | `action:<stable-id> in pages/_<partial>.md` | `use action like_tweet in pages/_tweet_card.md` |
| 引用 endpoint | `endpoint:<endpoint-id> in apis.md` | `triggers endpoint:timeline_v2` |
| 引用 pitfall | `pitfall:<pitfall-id> in pitfalls.md` | `see pitfall:login_wall_on_search` |
| 引用 endpoints.json | endpoint_id 直接出现，假定 `endpoints.json` 有同 id | `endpoint_id: timeline_v2` |

**ID 唯一性**：
- `page_id` / `workflow_id` / `pitfall_id` 在站点内全 sitemap 唯一
- `action:<id>` 在所在 page 内唯一（不同 page 可以重名）
- `endpoint_id` 跟 `endpoints.json` 同 id

---

## 5. Two-layer storage 行为 spec

| 维度 | 行为 |
|---|---|
| Read order | local overlay 优先 → fallback global seed |
| Conflict | 同 stable id 存在两层时，local 赢（用户的现实更权威）|
| Promotion | local 累积 → 显式 PR → 进 global |
| Demotion | 不存在 — global 永远不删除 entry，只标 stale |
| 文件 missing | 任一层 missing 该文件，自动 fallback 另一层；都 missing → 该 page/workflow 视为不存在 |

**Stable IDs 跨层匹配**：local 文件 `page_id: home` 跟 global 文件 `page_id: home` 是同一个，local 字段覆盖 global 字段。

### 5.1 Draft 放在 `sitemap/` 目录内

agent 发现新路径 / stale 修正 / 半成品流程时写 draft。**draft 必须放在 `sitemap/` 目录内**，命名为 `sitemap/draft-<topic>.md` 或 `sitemap/pages/<page>.draft.md`。

**❌ 不要**放在父目录（如 `~/.opencli/sites/<site>/sitemap.draft.md`） — `opencli browser open` 的 sitemap availability 检测只看 `sitemap/` 目录是否存在。draft 放父目录 → 检测不到 → agent 不会被提醒"有 sitemap" → 你的发现没人用。

正确：
```
~/.opencli/sites/twitter/sitemap/
├── SITE.md
├── pages/home.md
└── draft-search-filter.md       ← OK，会被检测到
```

错误：
```
~/.opencli/sites/twitter/
├── sitemap.draft.md             ← 检测不到，不会触发 availability
└── sitemap/                     ← 空 dir → 检测到但内容空
    └── (empty)
```

### 5.2 `site-alias.json`（optional, Phase 2）

`opencli browser open` 用 adapter registry 把 hostname → site 映射（如 `news.ycombinator.com → hackernews`）。如果 sitemap 先于 adapter 存在（即一个站还没人写 adapter 但有人写了 sitemap），registry 没数据，sitemap dir 检测不到。

future fix：sitemap dir 内放 `site-alias.json` 声明它服务的 hostname：

```json
{
  "hostnames": ["news.ycombinator.com", "hn.com"]
}
```

`resolveSitemapAvailabilityForUrl` 先看 alias → 再 fallback adapter registry → 再 fallback hostname-second-part heuristic。Phase 2 加，v1 PoC 用 adapter registry 已够。

---

## 6. Trust Reality 红线

sitemap 是 hint，browser state 是 truth。当冲突时：

1. **绝不**强迫 agent 按 sitemap 操作
2. agent 必须现场探测（用 `browser state` / `find`）
3. 把 sitemap 项标 stale：在 local overlay 加一条覆盖（同 stable id），把 `last_verified` 倒回 30 天前，或加 `stale: true` 字段
4. 把现实观察 dump 到 local overlay 的 `<file>.draft.md`

**反模式**：
- ❌ "sitemap 说有 Post 按钮，找不到就再找"
- ❌ 把 sitemap workflow 当 fixed plan，遇到 diverge 不回 probe
- ❌ silent-ignore mismatch 继续按 sitemap 操作

正确：
- ✅ "sitemap 说有 Post 按钮 → `find` 一下 → 不在 → 标 stale + 探测真实页面有没有别的发帖入口"

---

## 7. Validation rules（Phase 2 cron audit 用）

未来自动化 audit agent 可按这些规则检查 sitemap 健康：

### 7.1 File-level

- `body ≤ 800 token`（每个 .md 单独检查）
- `last_verified` 不老于 30 天 → 否则 flag `stale_age`
- `schema_version` 字段存在且 ≤ current

### 7.2 Cross-ref integrity

- workflow `Best path: adapter X` → adapter X 必须存在于 `cli-manifest.json`
- workflow `Fallback path` 引用的 `action:<id>` → 必须存在于对应 page
- page `Linked APIs` 的 `endpoint_id` → 必须存在于 `apis.md`
- `apis.md` 的 `endpoint_id` → 必须存在于同站 `endpoints.json`

### 7.3 Reality check

- action `Postconditions` 里的 `url_pattern` / `dom_anchor` → 用 `opencli browser` 实跑一遍，验证 anchor 仍可 resolve
- workflow `State signature.url_pattern` → 同上

失败 → 自动倒 `last_verified` 30 天前。

### 7.4 Forbidden content

- `apis.md` 不能含 endpoint URL / method / params / response（grep 检测）
- 任何文件不能含 secret pattern（cookie value / token string / API key — 用 regex 检测）

---

## 8. Cross-link

- [`../../opencli-adapter-author/references/strategy-selection.md`](../../opencli-adapter-author/references/strategy-selection.md) — `contract_strength` 和 `auth_strategy` 取值定义
- [`../../opencli-adapter-author/references/api-discovery.md`](../../opencli-adapter-author/references/api-discovery.md) — `endpoint_id` 怎么发现
- `~/.opencli/sites/<site>/endpoints.json` — endpoint 的真实 URL/method/params/response

---

## 9. Open questions（v1 暂未定，v2 跟数据决）

1. **`state_signature` 用什么 DSL**：现在写 `url_pattern: <regex>` + `dom_anchor: <semantic>`，未来可能需要更结构化（如 JSON path / xpath / a11y tree path）。等 PoC 实践后定
2. **多语言站 anchor**：现在建议 a11y role + name；不同 locale name 不同。是否一个 anchor 列表多 locale，还是一个 sitemap per locale？PoC 后决
3. **Validation cron 实现位置**：作为 OpenCLI 内置命令 `opencli sitemap audit`？还是独立 GitHub Action？Phase 2 决
