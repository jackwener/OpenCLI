# Sitemap Schema Reference

详细 schema 规范。`SKILL.md` 给的是 inline 模板，本文件 spec 化字段、约束、validation 规则、跨文件引用格式。

进入条件：先读 `SKILL.md` 拿到 framing（task execution graph for agents）和两层存储模型。本文件展开**怎么写得对**。

---

## 1. 文件层约束

### 1.1 大小约束（agent token budget）

**每个 .md 文件 body ≤ 800 token**（不含 frontmatter）。超过必须拆。

理由：agent 用 sitemap 是 lazy load 模式，只读"当前 page + 当前 workflow + 必要 pitfalls"。单文件大 → agent context 被沉默打爆，特别是 compaction 之后 re-load 时。

实操：
- 一个 page 有 > 8 个 action → 拆 `pages/<page>/index.md` + `pages/<page>/actions/<group>.md`
- 一个 workflow 步骤多 → 拆主线 + `workflows/<task>/sub/<step>.md`

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
- `pitfall_id` — stable id
- `trigger` — what causes this
- `symptom` — how agent observes the failure
- `workaround` — what to do instead
- `verified_at` — when last seen

---

## 3. Action Schema（pages 内）

每个 page 的 actions section 包含若干 action 节点。每个 action 必填字段：

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

State signature:                          # OPTIONAL — for multi-step internal recovery
  url_pattern: <regex or exact match>
  dom_anchor: <a11y role+name OR semantic selector>

Evidence:
- verified_at: YYYY-MM-DD
- observed_with: opencli browser <session> <command>
- trace: <path to trace artifact, optional>
- source: local | global
```

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

**State signature**（OPTIONAL）：用于 action **内部多步骤**的 mid-flight re-entry。
- 简单 action（单 click）不需要
- 复杂 action（"submit form" 包含 type + click + wait）建议加，agent 中断恢复时知道走到哪
- 跟 workflow 级 state signature 区分：workflow signature 是 "走到 workflow 第几步"，action signature 是 "action 内部第几步"

**Evidence**：trust gate — 没 evidence 的 action 不能 promote 到 global。
- `verified_at`：最近验证日期
- `observed_with`：当时跑的命令（用于复现）
- `trace`：optional，对复杂 action 建议附 trace artifact 路径
- `source`：`local` 或 `global`

### 3.2 Action id 命名约定

- 动词 + 名词：`open_compose / submit_post / scroll_for_more / dismiss_modal`
- 不要 page-prefix：action 默认作用域是它所在的 page，不要写 `home_open_compose`
- stable：跨 URL params / locale / A/B variant 都应稳定

---

## 4. 跨文件引用

sitemap 内部多文件互相引用。引用格式：

| 引用 | 格式 | 示例 |
|---|---|---|
| 引用 page | `pages/<page-id>.md` | `see pages/home.md` |
| 引用 workflow | `workflows/<task-id>.md` | `see workflows/publish-post.md` |
| 引用 action | `action:<stable-id> in pages/<page>.md` | `use action open_compose in pages/home.md` |
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
