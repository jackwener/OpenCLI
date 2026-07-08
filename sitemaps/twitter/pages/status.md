---
schema_version: 1.1
page_id: status
url_patterns:
  - https://x.com/<handle>/status/<numeric-id>
  - https://x.com/i/status/<numeric-id>
purpose: single tweet detail with thread / replies
last_verified: 2026-06-02
source: global
---

## Visual anchors

- a11y: `role=main` + `role=region name` 含 `"Conversation"` 或 `<handle>'s post`
- testid: 主 tweet `[data-testid="tweet"]`（listing page 用 `cellInnerDiv`，detail page 主 tweet 用 `tweet`）；reply composer `[data-testid="tweetTextarea_0"]` + `[data-testid="tweetButtonInline"]`
- pattern: 主 tweet 下方按 reply 时间排子 tweet，结构同 `_tweet_card`

## Actions

```yaml
### action:open_reply_composer_inline
pre: on /<handle>/status/<id>, detail loaded
do: click [data-testid="tweetTextarea_0"] || click [data-testid="reply"] button
post: textarea focused, submit button [data-testid="tweetButtonInline"] enables on input
fail: textarea not focusing | login modal
recover: keyboard shortcut `r`; mark composer stale if persistent
evidence: opencli browser click
```

```yaml
### action:submit_reply
pre: reply composer has text, submit enabled
do: opencli twitter reply --status-url <url> --text "..." || click [data-testid="tweetButtonInline"]
post: textarea cleared + toast "Your post was sent"; new reply appended below detail
fail: button enabled but silent timeout (see pitfall:reply_silent_fails_on_rich_content) | login modal
recover: adapter_health_update: opencli twitter reply -> suspect; apply pitfall workaround (single-paragraph plain text, escape bullets); long reply -> workflows/post.md + quote
evidence: opencli twitter reply
```

## Tweet card actions

主 tweet + 子 reply 都是 tweet card 形态，互动按钮见 [`pages/_tweet_card.md`](./_tweet_card.md)。

## Linked APIs

- endpoint:UserByScreenName — `<handle>` → userId 解析（reply / 子 tweet author 用）

## Page pitfalls

- detail page 主 tweet testid (`tweet`) ≠ listing page (`cellInnerDiv`) — a11y `role=article` 通用更安全
- 长 thread / quote detail 部分 mount，scroll 触发加载
- 删除的 tweet URL 仍可访问，detail 显示 `"This post is unavailable"` 占位
