---
schema_version: 1.1
last_verified: 2026-06-02
source: global
---

## Endpoint index

> 引用规则（schema §2.4）：`endpoint_id` 必须存在于 `~/.opencli/sites/twitter/endpoints.json`。本文件只放 endpoint_id + 触发关系 + contract_strength，URL/method/params/response 是 endpoints.json 单一来源。

### endpoint:UserByScreenName

- triggers_on_pages: [profile, status]
- triggered_by_actions: [resolve_handle_to_userid]
- contract_strength: internal-unstable
- notes: GraphQL `/i/api/graphql/{queryId}/UserByScreenName`，queryId 滚动见 pitfalls。所有 user-keyed adapter（tweets/likes/following/followers）的第一步。

### endpoint:UserTweets

- triggers_on_pages: [profile]
- triggered_by_actions: [load_user_timeline, scroll_for_more]
- contract_strength: internal-unstable
- notes: `data.user.result.timeline.timeline.instructions[].entries` 结构，TimelinePinEntry 必须 skip 才是 chronological feed。

---

## v1 gap（intentional）

twitter 的 adapter family (`clis/twitter/*.js`) 引用了 **34+ 个 GraphQL operation**（HomeTimeline / HomeLatestTimeline / SearchTimeline / CreateTweet / DeleteTweet / FavoriteTweet / UnfavoriteTweet / CreateRetweet / DeleteRetweet / CreateBookmark / Bookmarks / UserFollowing / Followers / NotificationsTimeline / TweetDetail / 等），但 `endpoints.json` 当前只有 **2 条**。

这是 schema §2.4 "endpoint_id 必须存在于 endpoints.json" 严格规则 surface 出来的真实 gap：

- **不是 sitemap 缺**：sitemap 不应该重复 endpoint detail
- **是 endpoints.json 缺**：adapter-author 应该回填这些 operation 到 endpoints.json

行动建议（不在本 PoC scope）：

- 跑 `opencli browser network` 抓 twitter session 一次拿到当前 queryId map，全量回写 endpoints.json
- step 3 数据显示 twitter COOKIE_API adapter 9 fixes/30 天 → queryId rotation 是主因，集中维护 endpoints.json 比 34 个 adapter 各自硬编码 fallback 价值更高

待 endpoints.json 补齐后，本文件 endpoint 列表会扩到完整。

---

## contract_strength 分布预期（基于 step 3 数据）

| 强度 | endpoint 类型 | twitter 实际 |
|---|---|---|
| stable | 公开签名 API | 无（无官方 v2 API 可用） |
| visible-ui | RSS / public profile HTML | `/<handle>/status/<id>` 公开 HTML（无登录可见 metadata），但 PoC v1 不依赖 |
| internal-unstable | GraphQL `/i/api/graphql/...` | 全部 34+ operation 都在此档 |

twitter 实战上 **全 endpoint 都是 internal-unstable** —— 这本身是 agent 路径决策的信号：能用 adapter 走 adapter，adapter broken 时 fallback 用 DOM (`workflows/*.md` 的 Fallback path)，而不是手解 GraphQL。
