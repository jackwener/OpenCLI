---
schema_version: 1.1
page_id: front
url_patterns:
  - https://news.ycombinator.com/
  - https://news.ycombinator.com/news
purpose: ranked front page (top stories), default landing
last_verified: 2026-06-02
source: global
---

## Visual anchors

- text: top nav strip `Hacker News | new | past | comments | ask | show | jobs | submit`
- pattern: 每个 story 是 2 个 `<tr>`：第一 `<tr class="athing" id="<id>">` 含 rank + title + url；紧邻 sibling `<tr>` 含 score + author + age + comment-count
- selector_pattern (id-anchored): `tr.athing[id="<id>"]`
- selector_pattern (sibling traversal): `tr.athing[id="<id>"] + tr` (subtext row)
- selector_pattern (attribute boundary): `a[href^="item?id="]` (comments link, NOT title link out to external)
- (testid: 不适用 — HN 无 data-testid 约定)

## Actions on this page

### action:open_story_detail
pre: on /news 或 /，目标 story id 已知（rank 仅作降级匹配）
do: opencli hackernews story <id> || click `tr.athing[id="<id>"] + tr a[href^="item?id="]`
post: URL → /item?id=<id> AND <title> 含 story 标题
fail: click 落到外部 URL（误点 title link） | athing 不在当前 page
recover: 误点外站立即 back; athing 找不到时 reload /news 或用 adapter 直 fetch; adapter_health_update: opencli hackernews story -> suspect
evidence: opencli hackernews top --limit 30 + opencli browser open

> **Anchor note**：`tr.athing:nth-child(<rank>)` 不安全 — HN 每个 story 是 athing row + subtext sibling row 两 `<tr>`，nth-child(rank) 不映射到 rank 序号。用 `[id="<id>"]` attribute selector 是 schema v1.1 §2.2 selector_pattern (id-anchored) 的典型案例。

### action:next_page
pre: on /news，已滚到底，footer `More` link visible
do: opencli hackernews top --offset <N> || click `a.morelink`
post: URL 加 ?p=<N> 或 ?next=<id>&n=<offset>，新 30 条 stories
fail: morelink 不存在（HN 默认 ~30 条/页）
recover: adapter --limit 跨页透明，DOM 翻页是 worse path; adapter_health_update: opencli hackernews top -> suspect
evidence: opencli hackernews top --offset 30

## Linked APIs

- endpoint_id: topstories (triggers_on: page load)
- endpoint_id: item (triggers_on: 每条 story → fan out item/<id>)

## Page-specific pitfalls

- title `<a>` 指向**原文 URL**，不是 HN 评论页。去评论必须 click `a[href^="item?id="]` (comments link) 而非 title
- HN 单页 ~30 story；超过用 `morelink` 或 adapter offset
