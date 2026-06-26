---
schema_version: 1.1
workflow_id: search
intent: search xiaohongshu for notes matching a keyword
last_verified: 2026-06-04
source: global
---

## Goal

按 keyword 搜小红书笔记列表，每条带 title / author / like_count / signed note URL（可 drill-down 到 note detail）。

- 高级 filter（sort by hot / newest / image-only / video-only / date range）**不在** v1 PoC scope，task agent 现阶段只能拿 default mixed feed
- 拿到 list 后 drill-down 单 note 走 `opencli xiaohongshu note <url>`，不属于本 workflow

## State signature

- entry: 任意 page on xiaohongshu.com, logged_in (cookie `web_session` 有效)
- success: 输出至少 1 条结构化 note row（title / author / note_url / like_count），或合法的 0 行（关键词无结果）

## Best path

```yaml
adapter: opencli xiaohongshu search
adapter_health: degraded  # API broken，已切 DOM scrape (issue #10)，仍标 healthy 不准
preconditions:
  - logged_in
  - keyword ready (中文需 UTF-8 直传，adapter 内部 encode)
estimated_turns: 1
```

直接 `opencli xiaohongshu search "<keyword>" --limit 20`。adapter 内部 navigate `/search_result/?keyword=<encoded>` + DOM scrape `section.note-item`。

## Fallback path

当 adapter 抛 typed error（AuthRequiredError / EmptyResultError / CommandExecutionError）或返回 unexpected empty 时：

```yaml
on_adapter_fail:
  - adapter_health_update: opencli xiaohongshu search -> suspect
  - if AuthRequiredError:
    - recovery: opencli xiaohongshu login  # pending: codex task #276 实现该子命令
    - 登录后 retry adapter 一次
  - opencli browser state (verify current URL/login wall)
  - goto https://www.xiaohongshu.com/search_result/?keyword=<URL-encoded keyword>
  - wait for section.note-item OR text "登录后查看搜索结果"
    - login wall 命中 -> 同 AuthRequired 路径
    - 6s 后仍无 note-item -> EmptyResultError
  - 用 action:read_card_meta in pages/_note_card.md 逐 card 抽取 {title, author, note_url, like_count}
  - 输出结构化 list
estimated_turns: 5
```

## Avoid

- 不要走 `/api/sns/web/v1/search/notes` XHR — `pitfall:search_api_returns_empty`，已 broken
- 不要自己从 note title 重建 URL 拼 `/explore/<note_id>` — `pitfall:note_url_requires_xsec_token`
- 关键词含特殊字符（空格 / 中英混排 / `&` / `#`）记得 URL-encode 或交给 adapter 处理
- 触发 `安全限制` toast 时停手 60s，不要循环 retry — `pitfall:security_block_on_repeated_access`

## Re-entry checkpoints

agent 中断后醒来按 `opencli browser state` URL 判断：

- on `/`，未搜过 → 重新跑 Best path
- on `/search_result/?keyword=<X>` 且 note-item 已渲染 → 从 Fallback step "read_card_meta" 起
- on `/login` 或命中 login wall overlay → 走 Recovery path：`opencli xiaohongshu login`（# pending: codex task #276），login 后回 Best path 重跑

## State validation

- 至少 1 条 row 输出 OR 合法的 0 行（page 显式 "暂无结果" 文案）
- 每 row 的 `note_url` **必含 `xsec_token` query**（否则 drill-down 必 403）
- like_count 是 string（小红书显示 `1.2万` 类压缩格式，不要假定 int）

## Stale markers

- adapter `opencli xiaohongshu search` 30 天内 fix PR 增多（DOM class 漂） → adapter_health audit 标 suspect
- `section.note-item` class 名换 / `登录后查看搜索结果` 文案换 → 视觉 anchor 需更新（PR #1507 已加 fallback selector，再换需第二层 fallback）
