---
name: opencli-sitemap-author
description: Use when creating or maintaining OpenCLI site sitemaps: agent-facing navigation, page-state, action, workflow, API-reference, pitfall, and fallback knowledge for a website. Use after browser exploration discovers durable site context, when a sitemap is stale, or when promoting local site knowledge into the repo.
allowed-tools: Bash(opencli:*), Read, Edit, Write, Grep
---

# opencli-sitemap-author

You are authoring a **task execution graph for agents**, not an SEO sitemap. The artifact should help an agent using `opencli browser` decide where it is, what path to take next, which OpenCLI adapter to prefer, and how to recover when the page disagrees with memory.

Keep the sitemap small and verified. Do not crawl a whole site. Capture only task-relevant paths that you actually observed.

---

## Storage Model

Two layers:

- **Global seed**: `sitemaps/<site>/` (top-level)
- **Local overlay**: `~/.opencli/sites/<site>/sitemap/`

Local overlay wins by stable id. Write new discoveries to local first. Promote to global only after review.

Recommended layout:

```text
sitemap/
  SITE.md                 # site purpose, auth assumptions, stable page ids
  pages/<page-id>.md      # page state signatures, actions, linked APIs
  pages/_<partial>.md     # cross-page UI partial (e.g. _tweet_card.md)
  workflows/<task-id>.md  # best path, fallback path, avoid list
  pitfalls.md             # durable failure modes and stale areas
```

### Size guidance（实测启发式）

`references/sitemap-schema.md` §1.1 spec 硬 800 token，但 PoC 实测简单站单 page 1-2 action 自然落到 800-2000 token。强拆反碎，author 用下表决策：

> spec 800 是 lazy-load 优化目标 + Phase 2 audit 阈值；下表是 author 实战决策辅助，**不替代 spec hard 限制**。超 800 的文件 audit 会 flag，author 解释（"5 个 cohesive UI primitive 一起放"）或拆。

| 文件 token | 决策 |
|---|---|
| < 1500 | 自然 size，不动 |
| 1500-3000 | 看 cohesion — 5 个 cohesive UI primitive 一起放 OK；mixed 内容拆 |
| > 3000 | **必拆** sub-file 或 partial（agent lazy load budget 真有限制） |

Phase 2 cron audit 按 token count 不按 byte count（CJK 中文 token-per-char 比 English 高 30-50%）。

---

## Authoring Loop

1. **Load existing memory**: read local overlay first, then global seed if present.
2. **Verify reality**: use `opencli browser <session> state`, `find`, `network`, and `analyze`; browser state is truth. If you just completed an `opencli-adapter-author` session for this site, start from the retained browse trace under `~/.opencli/sites/<site>/traces/` as seed evidence instead of re-discovering the path from zero.
3. **Record only durable structure**: page purpose, stable anchors, state signature, actions, workflows, API references, pitfalls.
4. **Use stable ids**: page/action/workflow ids should survive URL params, locale text drift, and minor layout changes.
5. **Write local draft**: update `~/.opencli/sites/<site>/sitemap/...` unless explicitly promoting to repo.
6. **Mark stale on conflict**: if existing sitemap disagrees with current browser state, trust browser state and mark the item stale rather than forcing the old path.

---

## Required Action Schema

Every action edge must include:

```yaml
### action:<stable-id>
pre: <current page / state / auth requirements>
do: <agent action, adapter command, or semantic browser command>
post: <URL / state / output that proves success>
fail: <failure signal 1> | <signal 2>
recover: <fallback instruction>; adapter_health_update: <adapter> -> suspect
evidence: opencli browser <cmd> or trace:<path>
```

Use this compact form by default. Use the longer Markdown form from `references/sitemap-schema.md` only when an action genuinely needs long explanation. `verified_at` and `source` are inherited from file frontmatter; do not repeat them per action.

Do not promote an action without evidence. If a recovery path marks `adapter_health_update`, the browser-sitemap consumer must write that health update to the local overlay so the next agent does not retry a known-suspect adapter.

### Partial pages（跨页通用 UI）

partial 文件 (`_<name>.md`，`url_patterns: []`) 装跨页 UI 原语（如 `_tweet_card.md` 的 like/reply/repost/bookmark）。被多 page 通过 `action:<id> in pages/_<name>.md` 引用。

**Partial scope rule**：partial 内所有 selector（testid / a11y / structural）**必须 scoped 到 partial root**，不能是 page-level first match。例如 `_tweet_card.md`:

```yaml
# ❌ 错：page-level first match，会点到 timeline 首条非 target card
do: click [data-testid="like"]

# ✅ 对：scoped 到 article root
do: click [data-testid="like"] in article[role="article"] (card scope)
```

partial 文件顶部写明 scope root 一行：

```md
## Card scope rule
所有 testid selector 必须 scoped 到 `article[role="article"]`，不能用 page-level first match。
```

---

## Workflow Fields

Each workflow should answer:

- **Goal**: user-facing task this workflow solves.
- **State signature**: minimal observable checkpoint for resume after sleep/compaction.
- **Best path**: prefer existing `opencli <site> <command>` adapter if it covers the goal.
- **Fallback path**: browser workflow if the adapter is missing or failing.
- **Avoid**: tempting paths that waste turns, trigger modals, or rely on unstable selectors.
- **Stale markers**: last verified date and known layout/API drift signals.

Endpoint/API knowledge should reference ids from `endpoints.json` when available. Do not duplicate full endpoint schemas inside sitemap files.

### Fallback `on_adapter_fail:` convention（推荐）

Fallback path 第一行声明触发条件 + adapter_health_update directive，把"为什么走 fallback"和"标 adapter suspect"放一起：

```yaml
on_adapter_fail:
  - adapter_health_update: opencli twitter post -> suspect
  - opencli browser state (verify current page)
  - if not on /home: goto /home
  - action:open_compose in pages/home.md
  - ...
```

比纯 step list 清晰：consumption skill 看到 `on_adapter_fail:` key 知道这是 adapter-trigger 而非 entry-point fallback，directive 先执行后续才走 steps。schema v1.2 candidate，目前作为 SKILL guideline 推荐。

## SITE.md `Top-level routes` — 标 uncovered routes

`SITE.md` 的 `Top-level routes` 不仅列已覆盖的 page，也应**显式标存在但 sitemap 不导航**的 route，避免 agent 默认"sitemap 没列 → 不存在"：

```md
## Top-level routes

- /home → pages/home.md
- /search → pages/search.md
- /messages → pages/messages.md（DM，本 PoC v1 不覆盖）   # ← 显式 uncovered marker
- /settings → 不在 sitemap scope，agent 自探         # ← 同上
```

不写 = agent 不知该 route 存在；写 + 标 uncovered = agent 知道存在但 sitemap 帮不上忙，自己探。

---

## Red Lines

- Sitemap is a hint; current browser state is truth.
- Do not write secrets, cookies, user-private ids, private messages, or account-specific values.
- Do not document bypasses for CAPTCHA, WAF, access control, rate limits, or paid gates.
- Do not store brittle snapshot indices like `[17]` as durable targets. Store semantic anchors and recovery instructions.
- Do not describe unverified paths as facts. Use `draft` or `stale` labels.
- Drafts go inside `sitemap/draft-<topic>.md`, not `~/.opencli/sites/<site>/sitemap.draft.md` at the parent level — the latter is invisible to `opencli browser` sitemap availability detection.

---

## Detailed schema

See [`references/sitemap-schema.md`](./references/sitemap-schema.md) for the full field-level spec — `SITE.md` / `pages/<id>.md` / `workflows/<id>.md` / `apis.md` / `pitfalls.md` schemas, action-level state signatures, `adapter_health` enum (healthy / suspect / broken), endpoint reference rules, two-layer overlay semantics, draft placement, and Phase 2 validation rules.
