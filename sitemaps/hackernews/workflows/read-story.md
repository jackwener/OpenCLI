---
schema_version: 1.1
workflow_id: read-story
intent: read a HN story and its top-level comments
last_verified: 2026-06-02
source: global
---

## Goal

拿到一条 HN story 的：标题 / URL / score / author / 时间 / top-level comments 列表。

## State signature

- entry: 任意 page，story id 或 URL 已知
- success: 拿到 story object + comments array

## Best path

- adapter: opencli hackernews story <id>
- adapter_health: healthy
- preconditions: story id 已知
- estimated_turns: 1

## Fallback path

如果 adapter 抛 typed error / 空 result（触发 `adapter_health_update: opencli hackernews story -> suspect`）：

1. `opencli browser open https://news.ycombinator.com/item?id=<id>`
2. action:expand_comment_tree in pages/item.md（如果有折叠）
3. `opencli browser state` 拿 DOM
4. parse story header (`tr.athing[id="<id>"]`) + comment tree (`tr.comtr` ids 数组)

- estimated_turns: 3-4

## Avoid

- 不要从 /news 列表 page 推断 story 内容（列表只有标题 + score，无评论）
- 不要 scrape 原文 URL（title link 指向外站，不是 HN 评论）
- 不要并发 fan-out 全 comment tree 走 `item/<kid_id>.json` (rate limit 风险；用 adapter 已 throttle)

## Re-entry checkpoints

- 已 open /item?id=<id>，DOM ready → step 2 起
- DOM 拿到但 expand 未做 → step 2 起
- story + comments 已收集 → 完成

## State validation

- story.title 非空
- comments array 长度 ≥ 0（dead story 可能 0）
- 至少 story.by + story.time 字段存在

## Stale markers

- HN HTML 结构非常稳（10+ 年不大改）
- Firebase API 是 read-only 公开服务，几乎不漂；endpoint:item 返回 schema 变化是大事件
