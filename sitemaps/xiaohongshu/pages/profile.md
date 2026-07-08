---
schema_version: 1.1
page_id: profile
url_patterns:
  - https://www.xiaohongshu.com/user/profile/*
purpose: user profile — bio, follower / following counts, user's published notes grid
last_verified: 2026-06-04
source: global
---

## Visual anchors

- a11y: 无明显 role
- pattern: bio container `.user-info` / `.user-page`；user notes grid 同 explore 复用 `section.note-item`
- selector_pattern: SSR Pinia store `window.__INITIAL_STATE__.user.notes` + `window.__INITIAL_STATE__.user.userPageData`
- text: follower / following 数字旁文案 `粉丝` / `关注`；login wall `请登录`

## Actions

```yaml
### action:read_user_notes
pre: on /user/profile/<id>, logged_in
do: opencli xiaohongshu user <id>
post: 输出用户 metadata + 笔记列表（href 自带 xsec_token，可 drill-down 到 note.md）
fail: AuthRequired | Empty (用户无笔记 / 私密 / 已注销) | CommandExecution (Pinia store 漂)
recover: AuthRequired -> opencli xiaohongshu login（# pending: codex task #276）；CommandExecution -> adapter_health suspect；Empty 视为合法
evidence: opencli xiaohongshu user
```

```yaml
### action:scroll_user_notes
pre: on /user/profile/<id>, notes grid loaded
do: evaluate("window.scrollBy(0, window.innerHeight * 2)")
post: 更多 section.note-item 追加，Pinia store 同步刷新
fail: 2s 无新 entry | 触发 security_block
recover: 已到尾 OR security_block；前者正常停手，后者 pitfall:security_block_on_repeated_access
evidence: opencli browser evaluate
```

## Note card actions

profile 页的 note grid 复用 `pages/_note_card.md`：

- use `action:open_note in pages/_note_card.md`

## Page pitfalls

- user_id 不是 short handle，是 24-hex MongoDB ObjectId 形式（e.g. `5be4c0710000000001003c10`）
- user 的 note 列表通过 SSR 一次性 hydrate 首屏，scroll 才触发更多 — 不要假定 first call 拿到全部
- 私密账号 / 已注销账号 store 仍 hydrate 但 notes 为空，adapter 抛 Empty 是合法
