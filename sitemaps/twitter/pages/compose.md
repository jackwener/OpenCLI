---
schema_version: 1.1
page_id: compose
url_patterns:
  - https://x.com/compose/tweet
  - https://x.com/compose/post
purpose: standalone compose modal (also available inline on /home and /status)
last_verified: 2026-06-02
source: global
---

## Visual anchors

- a11y: `role=dialog name="Post" | "Compose post"`
- testid: textarea `[data-testid="tweetTextarea_0"]`；submit `[data-testid="tweetButton"]` (modal — **不是** inline `tweetButtonInline`)；close `[data-testid="app-bar-close"]`
- pattern: dialog 上方 progress ring (character count)
- selector_pattern: URL `/compose/tweet` 是独立路由可直接 `goto`

## Actions

```yaml
### action:type_post_content
pre: textarea mounted and focused
do: type "..." into [data-testid="tweetTextarea_0"]; for RTL content per pitfall:rtl_text_breaks_compose_verify split into segments
post: textarea innerText contains input, submit button enabled, character count ring updates
fail: text not on screen | verify text fail | button not enabling
recover: clear + retype; RTL -> segmented retype; >280 char -> split to thread
evidence: opencli browser type
```

```yaml
### action:submit_modal_post
pre: textarea has content, submit enabled, on modal form (NOT inline)
do: opencli twitter post --text "..." || click [data-testid="tweetButton"] (NOT tweetButtonInline)
post: modal dismissed, URL returns to caller page, new post in timeline
fail: modal not dismissing | "Something went wrong" toast
recover: adapter_health_update: opencli twitter post -> suspect; close modal + retry; persistent fail -> workflows/post.md Fallback
evidence: opencli twitter post
```

```yaml
### action:dismiss_modal_with_draft
pre: decided not to send, textarea has content
do: click [data-testid="app-bar-close"] then click "Save" or "Discard" in dialog
post: modal closes, URL returns to caller page
fail: dismiss dialog buttons unresponsive
recover: ESC key; or navigate away (draft auto-save)
evidence: opencli browser click
```

## Linked APIs

无 — 该 page 自身只是 UI surface，actual post 触发的 `CreateTweet` endpoint 未在 `endpoints.json` 注册（见 apis.md v1 gap）

## Page pitfalls

- modal testid `tweetButton` vs inline `tweetButtonInline` 反复踩 — 写 selector 时**先检查 URL** 是否含 `/compose/` 判断 modal vs inline 形态
- 含 media upload 的 post 不在 PoC v1 覆盖：file picker / blob URL 复杂，adapter `opencli twitter post --image-url` 已 handle，task agent 直接走 adapter
