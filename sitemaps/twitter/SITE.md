---
schema_version: 1.1
site: x.com
last_verified: 2026-06-02
source: global
login_required: true
auth_strategy: COOKIE_API
---

## Overview

Twitter / X (`twitter.com` → 301 `x.com` since 2024)。微博形态的 social feed，agent 主要任务是读 timeline / 发推 / 回复 / 搜索 / bookmark / 看 profile。绝大多数读写都需要登录态（`auth_token` + `ct0` cookie）；未登录只能访问极少量 public surface（个别 profile / status URL）。

## Top-level routes

- `/home` → pages/home.md（主 timeline，登录后默认落地）
- `/explore` → pages/explore.md（搜索 + trending，公开可见骨架但内容需登录）
- `/<handle>` → pages/profile.md（用户 profile）
- `/<handle>/status/<id>` → pages/status.md（单条 tweet detail）
- `/compose/tweet` → pages/compose.md（发推 modal，也可在 /home inline 触发）
- `/notifications` → pages/notifications.md
- `/i/bookmarks` → pages/bookmarks.md
- `/messages` → pages/messages.md（DM，本 PoC v1 不覆盖）

## Common goals

- publish a post → workflows/post.md
- reply to a tweet → workflows/reply.md
- search for tweets / users → workflows/search.md
- bookmark a tweet → workflows/bookmark.md
- read user timeline → 直接用 adapter `opencli twitter tweets <handle>`，无需 workflow

## Site-wide pitfalls

详见 pitfalls.md。最容易踩的：

- 未登录访问大多数 route 会 redirect 到 `/i/flow/login` (login wall)
- mobile UA 会 redirect 到 `mobile.twitter.com` 后被 deprecate 弹窗拦，桌面 UA 必备
- GraphQL endpoint 的 `queryId` 随 bundle hash 滚动，硬编码 queryId 的 cookie-API adapter 易腐
- RTL 文本（阿拉伯/希伯来）在 compose 框 caret 行为异常，verify text 时多步 retry
