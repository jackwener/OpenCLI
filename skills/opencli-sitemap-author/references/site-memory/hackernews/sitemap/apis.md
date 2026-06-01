---
schema_version: 1.1
last_verified: 2026-06-02
source: global
---

## Endpoint index

HN 同时有两个 API 表面：

- **Firebase API** (`https://hacker-news.firebaseio.com/v0/...`) — 官方 read API，public，文档化 schema。**契约最强**，所有 read adapter 都走这里。
- **Algolia HN Search** (`https://hn.algolia.com/api/v1/...`) — 社区维护的 search，public，contract 也稳。HN 主域没 search API，必须用 algolia。

### endpoint:topstories
- triggers_on_pages: [front]
- triggered_by_actions: [page_load]
- contract_strength: stable
- notes: Firebase `/topstories.json` 返回 top 500 story id array，agent adapter 链 `item/<id>.json` 拿详情

### endpoint:newstories
- triggers_on_pages: [feed]
- triggered_by_actions: [page_load]
- contract_strength: stable
- notes: Firebase `/newstories.json`，同 topstories 模式

### endpoint:beststories
- triggers_on_pages: [feed]
- triggered_by_actions: [page_load]
- contract_strength: stable

### endpoint:askstories
- triggers_on_pages: [feed]
- triggered_by_actions: [page_load]
- contract_strength: stable

### endpoint:showstories
- triggers_on_pages: [feed]
- triggered_by_actions: [page_load]
- contract_strength: stable

### endpoint:jobstories
- triggers_on_pages: [feed]
- triggered_by_actions: [page_load]
- contract_strength: stable

### endpoint:item
- triggers_on_pages: [item, front, feed]
- triggered_by_actions: [page_load, expand_comments]
- contract_strength: stable
- notes: Firebase `/item/<id>.json`，story + comment 都是 item，type 字段区分 (story / comment / poll / pollopt / job)

### endpoint:user
- triggers_on_pages: [user]
- triggered_by_actions: [page_load]
- contract_strength: stable
- notes: Firebase `/user/<handle>.json`，含 submitted id array

### endpoint:algolia_search
- triggers_on_pages: [search]
- triggered_by_actions: [search_submit]
- contract_strength: stable
- notes: `/search?query=<q>`（relevance）+ `/search_by_date?query=<q>`（time），HN 主域无 search endpoint
