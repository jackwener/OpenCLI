---
schema_version: 1.1
last_verified: 2026-06-04
source: global
---

## Endpoint index

> 引用规则（schema §2.4）：`endpoint_id` 必须存在于 `~/.opencli/sites/xiaohongshu/endpoints.json`。本文件只放 endpoint_id + 触发关系 + contract_strength，URL/method/params/response 是 endpoints.json 单一来源。

### endpoint:HomeFeed_HydratedStore

- triggers_on_pages: [home, explore]
- triggered_by_actions: [load_home_feed]
- contract_strength: internal-unstable
- notes: 不是 XHR endpoint，是 SSR 直出 `window.__INITIAL_STATE__.feed.feeds`。adapter `feed.js` 直接读 Pinia store；走 next-page XHR `/homefeed` 的 items 无 `xsec_token`，drill-down 用不了。

### endpoint:NoteDetail_PiniaStore

- triggers_on_pages: [note]
- triggered_by_actions: [open_note_detail]
- contract_strength: internal-unstable
- notes: 同样是 SSR 直出 `window.__INITIAL_STATE__.note`。adapter `note.js` 当前走 DOM extraction (`.interact-container` scoped selectors)，store 路径是备选。

### endpoint:UserNotes_PiniaStore

- triggers_on_pages: [profile]
- triggered_by_actions: [load_user_notes]
- contract_strength: internal-unstable
- notes: SSR `window.__INITIAL_STATE__.user.notes` + `user.userPageData`，adapter `user.js` 已实现 `assertReadableUserSnapshot` validator。

---

## v1 gap（intentional）

xhs adapter family (`clis/xiaohongshu/*.js`) 引用的 endpoint 大多是 **SSR Pinia store snapshot** 而非可独立调用的 XHR：

- **search**：早期走 `/api/sns/web/v1/search/notes` 已 `data:{items:[]}` 空，现行 adapter 改 DOM scrape（issue #10 / pitfall:search_api_returns_empty）
- **publish**：creator center 走 form upload + CDP `DOM.setFileInputFiles` + shadow-DOM instance method invocation，不是 REST endpoint
- **comments / notifications**：走站内 XHR (`/api/sns/web/v2/comment/page` / `/api/sns/web/v1/you/...`)，可独立 fetch，但 endpoints.json 当前未回填

行动建议（不在本 PoC scope，留给 adapter-author follow-up）：

- 跑 `opencli browser network` 抓 xhs session 拿到当前 XHR endpoint set，回填 `~/.opencli/sites/xiaohongshu/endpoints.json`
- comments / notifications / creator-stats 这几条 XHR 形 endpoint 优先补，可见 contract 加强

---

## contract_strength 分布预期

| 强度 | endpoint 类型 | xhs 实际 |
|---|---|---|
| stable | 公开签名 API | 无（无官方开放 API） |
| visible-ui | 公开可见 HTML | 个别 `/explore/<note_id>` 公开 metadata，但需 `xsec_token` 才能完整 drill-down |
| internal-unstable | SSR Pinia store / 站内 XHR | 几乎全部 endpoint 都在此档 |

xhs 实战上 **全 endpoint 都是 internal-unstable** —— 同 twitter，意味着 agent 路径决策默认是 "能走 adapter 走 adapter，adapter broken 时 fallback DOM"（`workflows/*.md` 的 Fallback path），而不是手解 store 路径 / signed URL params。
