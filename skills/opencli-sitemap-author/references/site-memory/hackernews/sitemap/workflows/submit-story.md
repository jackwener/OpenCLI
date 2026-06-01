---
schema_version: 1.1
workflow_id: submit-story
intent: submit a new story to HN (URL or text post)
last_verified: 2026-06-02
source: global
---

## Goal

提交一条 story：title (≤80 char) + url XOR text body。URL post 或 Ask HN / Show HN 文本 post 二选一。

## State signature

- entry: 任意 page，logged_in，title 和 url(or text) 已准备
- success: redirect to /newest 顶部出现新 story by 当前 user

## Best path

- adapter: null
- adapter_health: broken （HN 无 write adapter，必须走 browser workflow）
- preconditions: logged_in / title ≤ 80 char / url or text ready
- estimated_turns: 4-5

## Fallback path

实际就是唯一 path（browser）：

1. `opencli browser open https://news.ycombinator.com/submit`
2. type title → `input[name="title"]`
3. type url → `input[name="url"]` || type text → `textarea[name="text"]` （**互斥**，不能同时填）
4. click `input[type="submit"]`
5. 验证 redirect /newest，顶部新 story by 当前 user

- estimated_turns: 4-5

## Avoid

- 不要同时填 url + text（HN 拒绝）
- 不要 submit 超过 daily rate limit (throw_too_fast)
- 不要重复 submit 同 URL（HN dedupe → 抛 "have submitted"）
- title 不带 emoji（部分 emoji 引起 form 拒收）

## Re-entry checkpoints

- 已 open /submit，form empty → step 2 起
- title filled 但 url/text 未填 → step 3 起
- form 全填但未 submit → step 4 起
- redirect /newest 且 story 出现 → 完成

## State validation

- redirect URL 含 `/newest` 或 `/item?id=<new-id>`
- /newest 顶部 story.by 等于当前 user
- title 完全匹配（HN 不修改 title）

## Stale markers

- /submit form field name (`title` / `url` / `text`) 几乎不变（10 年没改 form schema）
- HN 偶尔加 captcha 给 new user (< 7 天账号)
