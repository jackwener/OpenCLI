---
schema_version: 1.1
site: xiaohongshu.com
last_verified: 2026-06-04
source: global
login_required: true
auth_strategy: COOKIE_API
login:
  # pending: login command MVP (codex task #276) — 命令 ship 后去掉本注释
  login_url: https://www.xiaohongshu.com/login
  verify:
    - kind: adapter_probe
      command: [xiaohongshu, whoami]
      strength: strong
    - kind: read_probe
      command: [xiaohongshu, feed, "--limit", "1"]
      strength: medium
      notes: feed 走 SSR Pinia store，未登录会 redirect /login 或 store 缺 `feed.feeds`
    - kind: cookie_probe
      cookies: [web_session]
      domain: .xiaohongshu.com
      strength: weak
      notes: web_session 在但 server revoke 会假阳性；只做 precheck
    - kind: dom_probe
      url: https://www.xiaohongshu.com/explore
      signal: 未出现"登录后查看搜索结果"/"请登录"文案 且 `.user-avatar` 存在
      strength: weakest
      notes: 最后兜底，DOM rebrand 易腐
---

## Overview

小红书 (`xiaohongshu.com`，前身 redbook / 简称 xhs / 海外品牌 rednote)。图文笔记 + 短视频 social feed，agent 主要任务是搜笔记 / 发笔记 / 读笔记内容 + 评论 / 看 creator 数据。**大多数读写都需要登录态**（`web_session` cookie）；未登录只能访问极少量 public surface（个别 note URL，且 search / explore / user profile 都触发 login wall）。

**Creator center 是独立 host `creator.xiaohongshu.com`**：发笔记 / 草稿 / creator stats 走这个域；feed / search / note detail 走主站 `www.xiaohongshu.com`。两 host 共享 SSO（同 cookie），但路由结构 / DOM 完全不同。

## Top-level routes

- `/` `/explore` → pages/explore.md（首页 feed / explore feed，未登录有 login wall）
- `/search_result/?keyword=...` → pages/explore.md（搜索结果，同 explore 复用）
- `/user/profile/<id>` → pages/profile.md（用户 profile）
- `/explore/<note_id>?xsec_token=...` → pages/note.md（笔记详情，需 signed URL）
- `creator.xiaohongshu.com/publish/publish?from=menu_left&target=image` → pages/compose.md（图文发布，creator center）
- `/notifications` → 直接用 adapter `opencli xiaohongshu notifications`，无 workflow
- `creator.xiaohongshu.com/creator/notes` → 直接用 adapter `opencli xiaohongshu creator-notes`，无 workflow

## Common goals

- search notes by keyword → workflows/search.md
- publish an image note → workflows/publish.md
- comment on a note → workflows/comment.md
- read a note's full content + comments → 直接用 adapter `opencli xiaohongshu note <url>` + `opencli xiaohongshu comments <url>`
- read user's notes → 直接用 adapter `opencli xiaohongshu user <id>`

## Site-wide pitfalls

详见 pitfalls.md。最容易踩的：

- 大多数 route 未登录会 login wall（搜索 / explore / profile / notifications 全中）
- 主站 `www.xiaohongshu.com` 与 creator center `creator.xiaohongshu.com` 是两套 DOM，发笔记必须走 creator host
- note URL 必须带 `xsec_token` query 参数才能 drill-down（feed/search 出来的 URL 自带，但手拼裸 `/explore/<note_id>` 会 403）
- search API 已 broken，现行 search adapter 走 DOM scrape（见 `pitfall:search_api_returns_empty`）
- creator center 的 publish button 是 closed shadow DOM 自定义元素，host-level `.click()` 不触发；adapter 内已用 instance method invocation 兜底，task agent 不要手 click
