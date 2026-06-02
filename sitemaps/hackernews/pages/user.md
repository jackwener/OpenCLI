---
schema_version: 1.1
page_id: user
url_patterns:
  - https://news.ycombinator.com/user?id={handle}
purpose: user profile view (karma + about + submitted list)
last_verified: 2026-06-02
source: global
---

## Visual anchors

- text label: `user:`, `created:`, `karma:`, `about:` row labels
- selector_pattern (attribute boundary): `a[href^="submitted?id="]`, `a[href^="threads?id="]`
- selector_pattern (sibling, in `<table>`): each `<tr>` row 含 label + value

## Actions on this page

### action:open_submissions
pre: on /user?id=<handle>
do: opencli hackernews user <handle> || click `a[href^="submitted?id="]`
post: URL → /submitted?id=<handle>，story list visible
fail: redirect 404 (handle 不存在)
recover: handle 不存在抛 CommandExecutionError; adapter_health_update: opencli hackernews user -> suspect
evidence: opencli hackernews user <handle>

## Linked APIs

- endpoint_id: user (triggers_on: page load)

## Page-specific pitfalls

- handle case-sensitive，pg ≠ Pg
- newly-created user 的 about field 可能 null
