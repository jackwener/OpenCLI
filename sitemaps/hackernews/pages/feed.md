---
schema_version: 1.1
page_id: feed
url_patterns:
  - https://news.ycombinator.com/newest
  - https://news.ycombinator.com/best
  - https://news.ycombinator.com/ask
  - https://news.ycombinator.com/show
  - https://news.ycombinator.com/jobs
purpose: paginated list of stories sharing front-page DOM structure (newest / best / show / ask / jobs)
last_verified: 2026-06-02
source: global
---

## Visual anchors

- pattern: 跟 front.md 完全同结构（`tr.athing` + sibling subtext row）
- text: 顶部 nav 高亮当前 tab (new/best/ask/show/jobs)
- selector_pattern: 同 front.md（id-anchored / sibling / attribute boundary）

## Actions on this page

action:open_story_detail in pages/front.md
action:next_page in pages/front.md

（DOM 结构与 front.md 完全一致，action 通过 reference 复用，不复制定义）

## Linked APIs

按 URL 路由不同 endpoint：
- /newest → endpoint_id: newstories
- /best → endpoint_id: beststories
- /ask → endpoint_id: askstories
- /show → endpoint_id: showstories
- /jobs → endpoint_id: jobstories

## Page-specific pitfalls

- 跨 feed 类型用同 DOM，但 API endpoint 不同 — adapter `opencli hackernews <feed>` 已封装路由，DOM scrape 只看 URL 不看页面差异
