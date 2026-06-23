---
schema_version: 1.1
page_id: _tweet_card
url_patterns: []
purpose: partial — actions on any tweet card (used by home / status / profile / notifications / bookmarks)
last_verified: 2026-06-02
source: global
---

> Partial：`_` 前缀 + 空 `url_patterns` = 跨页通用 UI。其他 page 通过 `action:<id> in pages/_tweet_card.md` 引用。

## Visual anchors

- pattern: `article[role="article"]` 内 `[data-testid="cellInnerDiv"]`
- testid: `[data-testid="like|unlike|reply|retweet|unretweet|bookmark|removeBookmark"]`
- selector_pattern: `article a[href*="/status/"]`（permalink，可提 tweet_url）
- a11y: article `aria-label` 含 author / 时间 / 互动计数

## Card scope rule（全 action 共享）

所有 testid selector 必须 scoped 到 card root `article[role="article"]`，**不能** 用 page-level first match，否则点到 timeline 首条非 target card。

## Actions

```yaml
### action:open_status
pre: card visible
do: click article a[href*="/status/"] || evaluate href then goto
post: URL -> /<handle>/status/<id>
fail: stays on listing | modal not nav | 404
recover: goto explicit URL; if 404 mark tweet stale
evidence: opencli browser click + state
```

```yaml
### action:like_tweet
pre: card visible AND tweet_url known (or extract via article a[href*="/status/"])
do: opencli twitter like <tweet-url> || click [data-testid="like"] in card scope
post: card testid like -> unlike, icon red
fail: testid unchanged | login modal | wrong card flipped (scope missing)
recover: adapter_health_update: opencli twitter like -> suspect; dom_click in card scope; rollback via [data-testid="unlike"]
evidence: opencli twitter like
```

```yaml
### action:open_reply
pre: card visible
do: click [data-testid="reply"] in card scope
post: composer shown, [data-testid="tweetTextarea_0"] focused, URL unchanged
fail: login modal | composer not appearing
recover: keyboard `r` if tweet focused; or goto status page use reply CTA
evidence: opencli browser click
```

```yaml
### action:repost_tweet
pre: card visible AND tweet_url known
do: opencli twitter retweet <tweet-url> || click [data-testid="retweet"] in card then [data-testid="retweetConfirm"]
post: card testid retweet -> unretweet
fail: confirm menu missing | testid unchanged
recover: adapter_health_update: opencli twitter retweet -> suspect; dom_click confirm flow; rollback via [data-testid="unretweet"] + confirm
evidence: opencli twitter retweet
```

```yaml
### action:bookmark_tweet
pre: card visible AND tweet_url known
do: opencli twitter bookmark <tweet-url> || click [data-testid="bookmark"] in card scope
post: card testid bookmark -> removeBookmark, toast "Added to your Bookmarks"
fail: testid unchanged | toast missing
recover: adapter_health_update: opencli twitter bookmark -> suspect; dom_click + verify toast
evidence: opencli twitter bookmark
```

## Notes

- logged-out 点 card action 弹 login modal — `pitfall:login_wall_on_most_routes`
- adapter fail → DOM click fallback 是 site-wide 模式 — `pitfall:adapter_returns_empty_after_api_drift in ../pitfalls.md`
