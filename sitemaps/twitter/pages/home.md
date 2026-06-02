---
schema_version: 1.1
page_id: home
url_patterns:
  - https://x.com/home
  - https://x.com/i/timeline
purpose: main personalized feed; default landing after login
last_verified: 2026-06-02
source: global
---

## Visual anchors

- a11y: `role=main` + `role=region name="Timeline: Your Home Timeline" | "Timeline: For You"`
- pattern: feed items `[data-testid="cellInnerDiv"]` 包 `article[role="article"]`
- testid: sidebar compose `[data-testid="SideNav_NewTweet_Button"]`；inline composer `[data-testid="tweetTextarea_0"]` / `[data-testid="tweetButtonInline"]`
- text: top tab `"For you"` / `"Following"`（locale 漂 — `pitfall:button_not_found_in_non_english_locale`）

## Actions

```yaml
### action:open_compose
pre: on /home, logged_in, compose dialog not open
do: click [data-testid="SideNav_NewTweet_Button"] || focus [data-testid="tweetTextarea_0"]
post: textarea focused with role="textbox", submit button rendered
fail: button_not_found | URL -> /i/flow/login
recover: find --css [data-testid="tweetTextarea_0"] OR [data-testid="SideNav_NewTweet_Button"] (testid > visible text, cross locale stable); if both miss fallback find "What's happening" textarea; session 失效 -> AuthRequired
evidence: opencli browser click + state
```

```yaml
### action:submit_post
pre: textarea has text, submit button enabled
do: opencli twitter post --text "..." || click [data-testid="tweetButtonInline"]
post: textarea cleared + toast "Your post was sent"; new post in timeline within 5s
fail: button disabled | toast missing | textarea retains content > 5s
recover: adapter_health_update: opencli twitter post -> suspect; check text length / login; or workflows/post.md Fallback
evidence: opencli twitter post
```

```yaml
### action:scroll_for_more
pre: on /home, feed loaded
do: evaluate("window.scrollBy(0, window.innerHeight)")
post: new [data-testid="cellInnerDiv"] entries appended in DOM
fail: 2s 无新 entry | top "Try again" banner | 429 toast
recover: wait 2s then retry; consecutive fail -> mark stale
evidence: opencli browser evaluate
```

## Tweet card actions

home timeline 里每个 tweet card 上的 like / reply / repost / bookmark 是跨页通用 UI，定义在 [`pages/_tweet_card.md`](./_tweet_card.md)。

- use `action:like_tweet in pages/_tweet_card.md`
- use `action:open_reply in pages/_tweet_card.md`
- use `action:bookmark_tweet in pages/_tweet_card.md`
- use `action:open_status in pages/_tweet_card.md`

## Page pitfalls

- inline composer 与 `/compose/tweet` modal 两形态：testid `tweetTextarea_0` 通用；submit button modal 用 `tweetButton`，inline 用 `tweetButtonInline`
- `For you` vs `Following` 是 ranking 差不是数据源差（HomeTimeline vs HomeLatestTimeline GraphQL）
