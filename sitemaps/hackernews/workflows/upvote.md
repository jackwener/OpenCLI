---
schema_version: 1.1
workflow_id: upvote
intent: upvote a story or comment
last_verified: 2026-06-02
source: global
---

## Goal

对一条 story 或 comment 投上票。需 login，不可投自己内容。

## State signature

- entry: 任意 page，logged_in，目标 item id 已知
- success: vote arrow 灰显（已投状态）

## Best path

- adapter: null
- adapter_health: broken （HN 无 write adapter，必须走 browser workflow）
- preconditions: logged_in / target item id 已知 / 不是自己内容
- estimated_turns: 2

## Fallback path

唯一 path：

1. `opencli browser open https://news.ycombinator.com/item?id=<id>` 或 /news 找到该 item
2. action:upvote in pages/item.md

- estimated_turns: 2

## Avoid

- 不要 vote 自己的 story / comment（HN NoOp，arrow 不显示）
- 不要快速连续 vote 多条（rate limit，~10s 内 >5 票触发 cool-down）
- 不要 hardcode vote URL（必须从页面 `a[id="up_<id>"]` 提 csrf token）

## Re-entry checkpoints

- 已 open /item?id=<id>，arrow visible → step 2
- arrow 已灰 → 完成（idempotent，不重复 click）

## State validation

- `a[id="up_<id>"]` 从有效变灰（class 含 `nosee` 或 visibility hidden）
- 自己 user profile karma +1（异步，可能延迟）

## Stale markers

- HN vote URL 含 auth token，token 生成机制偶尔小调（极罕见）
- pitfall:vote_requires_login_and_csrf 一直有效
