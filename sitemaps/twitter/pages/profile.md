---
schema_version: 1.1
page_id: profile
url_patterns:
  - https://x.com/<handle>
  - https://x.com/<handle>/with_replies
  - https://x.com/<handle>/media
  - https://x.com/<handle>/likes
purpose: a user's profile + their tabs (posts / replies / media / likes)
last_verified: 2026-06-02
source: global
---

## Visual anchors

- a11y: `role=main` + `role=region name="Timeline: <handle>"`
- testid: `[data-testid="UserName"]` / `[data-testid*="-follow"]` / `[data-testid*="-unfollow"]` / `[data-testid="primaryColumn"]`
- pattern: tab strip `role="tablist"` 含 `Posts / Replies / Highlights / Articles / Media / Likes`
- selector_pattern: URL `<handle>` 纯字母数字+下划线 1-15 长度，不带 `@`

## Actions

```yaml
### action:follow_user
pre: logged-in user != target user AND follow button testid shows "Follow"
do: opencli twitter follow <handle> || click [data-testid*="-follow"]
post: button text -> "Following", testid -> [data-testid*="-unfollow"]
fail: button text unchanged | login modal | "Follow blocked" toast
recover: adapter_health_update: opencli twitter follow -> suspect; dom_click [data-testid*="-follow"]; rollback via unfollow button
evidence: opencli twitter follow
```

```yaml
### action:switch_tab
pre: on profile page AND target tab visible in tablist
do: click role="tab" matching Posts|Replies|Media|Likes || goto /<handle>/<sub-path>
post: URL switches to sub-path, timeline region re-renders
fail: tab unresponsive | URL unchanged
recover: use goto with explicit URL instead of click
evidence: opencli browser click + state
```

## Tweet card actions

profile timeline 上每个 tweet card 用 [`pages/_tweet_card.md`](./_tweet_card.md) 定义的 action（like / reply / repost / bookmark / open_status）。

## Linked APIs

- endpoint:UserByScreenName — handle → numeric userId 解析（所有 profile-keyed adapter 第一步）
- endpoint:UserTweets — Posts tab 数据源

## Page pitfalls

- pinned tweet 永远在最顶不按时间排（adapter 内部处理，task agent 无需 distinguish）
- `<handle>` 大小写不敏感但 URL 保留原样，adapter 内 normalize
- suspended/banned user 显示 "Account suspended" 占位，结构完全不同 → 标 stale 抛 EmptyResult
