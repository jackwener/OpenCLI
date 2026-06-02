---
schema_version: 1.1
workflow_id: post
intent: publish a text-only public post
last_verified: 2026-06-02
source: global
---

## Goal

发一条公开 **text-only post，≤ 280 char，无 media / poll / schedule / thread-split**。

- 带 media 走 adapter `opencli twitter post --image-url` 直接路径
- thread-split (> 280 char) / poll / schedule 不在 v1 PoC scope（caller 应在调本 workflow 前处理 split 或选其他 workflow）

## State signature

- entry: 任意 page on x.com, logged_in (cookie `auth_token` 有效)
- success: timeline 5s 内看到新 post 出现在自己的 home / profile

## Best path

```yaml
adapter: opencli twitter post
adapter_health: healthy
preconditions:
  - logged_in
  - text content ready (<= 280 chars)
estimated_turns: 1
```

直接 `opencli twitter post --text "<content>"`。adapter 内部 handle COOKIE 注入 / queryId rotation / verify。

## Fallback path

当 adapter 抛 typed error (EmptyResultError | CommandExecutionError) 或返回 unexpected empty 时：

```yaml
on_adapter_fail:
  - adapter_health_update: opencli twitter post -> suspect
  - opencli browser state (verify current page)
  - if not on /home: goto /home
  - action:open_compose in pages/home.md
  - type content into [data-testid="tweetTextarea_0"]
  - action:submit_post in pages/home.md
  - verify timeline top shows new post within 5s
estimated_turns: 4
```

## Avoid

- 不要在 mobile UA 下手 click sidebar `New Post` 按钮 — `pitfall:wrong_dom_when_ua_mobile`
- 不要 `goto /compose/tweet` 后再用 inline composer testid `tweetButtonInline`，modal 形态用 `tweetButton`（见 `pages/compose.md`）
- RTL 内容不要单段一次 type — `pitfall:rtl_text_breaks_compose_verify`
- 不要 adapter 失败时反复 retry adapter — 直接走 Fallback，否则浪费 turn

## Re-entry checkpoints

agent 中断后醒来按 `browser state` URL 判断：

- on /home, compose dialog NOT visible → 从 Fallback step 2 起
- on /home OR /compose/tweet, textarea visible 且 text 已部分输入 → step 3 起（continue type 剩余）
- on /home, 新 post 已在 timeline 顶部 → 已完成

## State validation

- timeline 顶部出现 author=self 的新 entry
- entry text **normalized 匹配** submitted content：
  - trim 前后 whitespace
  - Twitter 自动 URL 化（裸 URL → t.co shortlink + display URL，按 display URL 或原 URL substring 匹配）
  - emoji / unicode NFC normalize 保留
  - **不要** 用 strict equality（whitespace 折叠 / URL 转换造成假失败）
- entry 时间显示 "now" / "1s ago"

## Stale markers

- adapter `opencli twitter post` 30 天内 fix PR 增多 → adapter_health audit 标 suspect
- submit button text "Post" 变化（i18n / rebrand 二轮）→ visual anchors 需更新
