---
schema_version: 1.1
workflow_id: bookmark
intent: bookmark a tweet (add or remove)
last_verified: 2026-06-02
source: global
---

## Goal

把一条 known tweet URL 加入 / 移出当前账户的 bookmark 列表。

## State signature

- entry: 知道 target tweet URL, logged_in
- success: tweet card 工具栏 testid `bookmark` ↔ `removeBookmark` 翻转, toast 出现

## Best path

```yaml
adapter: opencli twitter bookmark
adapter_health: healthy
preconditions:
  - logged_in
  - target_status_url known
estimated_turns: 1
```

`opencli twitter bookmark <status-url>` add, `opencli twitter unbookmark <status-url>` remove。

## Fallback path

```yaml
on_adapter_fail:
  - adapter_health_update: opencli twitter bookmark -> suspect
  - goto <status-url> (lands pages/status.md)
  - action:bookmark_tweet in pages/_tweet_card.md
  - verify testid flip + toast "Added to your Bookmarks"
estimated_turns: 2
```

## Avoid

- 不要从 listing page (home / search) click bookmark — card 分页加载结构不一定 stable，直接 `goto <status-url>` 在 detail page 操作更可靠
- 不要 bookmark + 立刻 unbookmark 做 toggle test — 短时间 toggle 留 race-condition testid 状态，会误判 `adapter_health=suspect`
- 不要 click `[data-testid="bookmark"]` 期望 idempotent — click 已 bookmarked tweet 会 remove，必须先验当前 testid 状态

## Re-entry checkpoints

- on /<handle>/status/<id>, 工具栏 testid `bookmark` (未收藏) → 走 add 路径
- on /<handle>/status/<id>, 工具栏 testid `removeBookmark` (已收藏) → 已完成（add 任务）或继续 remove
- toast 已出现 → 完成

## State validation

- testid 状态正确翻转
- toast 文本匹配 "Added to your Bookmarks" / "Removed from your Bookmarks"
- 取查 `https://x.com/i/bookmarks` 列表能找到 / 已不在该 tweet（强验证, 需多 1 轮 navigation）

## Stale markers

- bookmark icon testid 名变（历史从 `bookmark` 改过一次, rebrand 可能再改）
- toast 文本 i18n 漂
- adapter `opencli twitter bookmark` 月度 fix 多 → adapter_health audit suspect
