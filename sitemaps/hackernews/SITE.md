---
schema_version: 1.1
site: news.ycombinator.com
auth_strategy: PUBLIC_API
login_required: false
last_verified: 2026-06-02
source: global
---

## Overview

Hacker News (HN). Classic SSR HTML + public Firebase API. Read-only reads do not need login; submit / comment / vote require account.

## Top-level routes

- /news → pages/front.md (front page, default landing)
- /newest → pages/feed.md (newest)
- /best → pages/feed.md (best, sorted by score)
- /ask → pages/feed.md (Ask HN)
- /show → pages/feed.md (Show HN)
- /jobs → pages/feed.md (Jobs)
- /item?id=<id> → pages/item.md (single story + comments)
- /user?id=<handle> → pages/user.md (user profile + recent submissions)

## Common goals

- read front page → 直接用 adapter `opencli hackernews top`，无需 workflow
- read newest / best / show / ask / jobs → adapter `opencli hackernews <feed>`，无需 workflow
- read single story + comments → adapter `opencli hackernews story <id>`，无需 workflow
- search → adapter `opencli hackernews search`，无需 workflow
- read user profile → adapter `opencli hackernews user <handle>`，无需 workflow
- submit a story (login required, agent-driven) → workflows/submit-story.md (browser only — no write adapter)
- comment / reply → workflows/comment.md (browser only)
- upvote → workflows/upvote.md (browser only)

## Site-wide pitfalls

详见 pitfalls.md。简版：
- Firebase API 不带 search（用 algolia HN search endpoint）
- HTML 缺 class hooks，要靠 `<tr class="athing">` + sibling row 模式
