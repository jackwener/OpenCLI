---
schema_version: 1.1
page_id: item
url_patterns:
  - https://news.ycombinator.com/item?id={id}
purpose: single item view (story + comments OR comment thread OR ask/show post)
last_verified: 2026-06-02
source: global
---

## Visual anchors

- pattern: 顶部 `<tr>` 是 story header（同 front.md athing 结构）；comment 树是 `<tr class="athing comtr">` 嵌套 indent，indent level 看 `<td class="ind"><img width="<N*40>">` 的 width
- selector_pattern (id-anchored): `tr.athing[id="<id>"]`, `tr[id="<id>"]` (comment), `a[id="up_<id>"]` (vote arrow)
- selector_pattern (sibling traversal): `tr.athing > td > div.commtext` (comment text), `tr#<id> > td.ind` (indent level)
- selector_pattern (attribute boundary): `a[href^="reply?id="]`, `a[href^="vote?id="]`
- selector_pattern (form name on /reply): `textarea[name="text"]`
- text-fold marker: `a.togg` (折叠态 `[N more]` 文案；折叠 state 用 class 不靠文案，文案仅 confirmation)

## Actions on this page

### action:expand_comment_tree
pre: on /item，folded comment 存在 (`a.togg` class)
do: opencli hackernews story <id> (API 拿全树) || click `a.togg`
post: 子 comment 行展开（DOM 多 `<tr class="comtr">`）
fail: togg link 不响应（极少）
recover: 直接走 Firebase `item/<id>.json` 递归 kids; adapter_health_update: opencli hackernews story -> suspect
evidence: opencli hackernews story <id>

### action:open_reply_form
pre: on /item，logged_in，目标 comment 有 reply link
do: click `a[href^="reply?id="]`
post: URL → /reply?id=<id>，textarea[name="text"] visible
fail: redirect /login (未登录) | throw_too_fast (HN 风控 cool-down)
recover: 未登录抛 AuthRequired; throw_too_fast 标 pitfall:hn_rate_limit 等 10-30s 重试
evidence: opencli browser click + state

### action:upvote
pre: on /item，logged_in，未投过票（`a[id="up_<id>"]` 可见且未灰）
do: click `a[id="up_<id>"]`
post: arrow 灰显（已投），不可再 click
fail: arrow 消失（HN 不允许 vote own post）| redirect /login
recover: 不允许 vote own 抛 CommandExecutionError; 未登录抛 AuthRequired
evidence: opencli browser click

## Linked APIs

- endpoint_id: item (triggers_on: page load + expand_comment_tree 递归 kids)

## Page-specific pitfalls

- vote URL 含 csrf-like `?auth=<token>` 不能 hardcode
- comment "reply" 必须 login，未登录 click redirects /login
