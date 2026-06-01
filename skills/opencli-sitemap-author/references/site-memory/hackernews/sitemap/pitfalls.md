---
schema_version: 1.1
last_verified: 2026-06-02
source: global
---

## Site-specific pitfalls (task-executor 视角)

### pitfall:firebase_id_array_fan_out_required
- trigger: agent 期望 `/topstories.json` 直接返回 story 详情
- symptom: 拿到的是 id array `[3819,3820,...]` 不是 object array
- workaround: 链 `/item/<id>.json` 一一拿；用 adapter `opencli hackernews top` 已封装这个 fan-out
- verified_at: 2026-06-02

### pitfall:no_search_on_main_domain
- trigger: agent 在 news.ycombinator.com 找 search UI / 直接 fetch 主域 /search
- symptom: 主域顶部无 search 框，404 on /search
- workaround: 用 Algolia HN search endpoint（apis.md `algolia_search`）或 adapter `opencli hackernews search`
- verified_at: 2026-06-02

### pitfall:html_lacks_semantic_classes
- trigger: agent 想从 DOM scrape 而非用 API
- symptom: `<tr class="athing">` 后跟 sibling `<tr>` 包含 score/author/comment-count，结构靠 sibling 关系而非嵌套
- workaround: 优先走 API（contract_strength=stable），DOM scrape 是 worse path；如必须 scrape，用 sibling traversal `tr.athing + tr` 而非裸 selector
- verified_at: 2026-06-02

### pitfall:vote_requires_login_and_csrf
- trigger: agent 用 browser primitives 模拟 upvote
- symptom: vote URL 含 token query param `?how=up&auth=<csrf>&id=<id>&...`，无 login session 直接 404 或 redirect /login
- workaround: 必须先 login，CSRF token 从 vote arrow `<a id="up_<id>">` 的 href 里 extract，不能 hardcode
- verified_at: 2026-06-02

### pitfall:firebase_returns_null_for_dead_or_deleted
- trigger: agent 期望 item endpoint 总返回 object
- symptom: deleted/dead item 返回 `null`，不是 error
- workaround: typed error 抛 `EmptyResultError`；不能 silent treat as not_found（adapter-internal 解决，task-executor 看 adapter 健康即可）
- verified_at: 2026-06-02
