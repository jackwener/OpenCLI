---
schema_version: 1.1
page_id: explore
url_patterns:
  - https://www.xiaohongshu.com/
  - https://www.xiaohongshu.com/explore
  - https://www.xiaohongshu.com/search_result/?keyword=*
purpose: home feed / explore feed / search results — same DOM shape, same note-card grid
last_verified: 2026-06-04
source: global
---

## Visual anchors

- a11y: `role=main` 内 note grid（无明确 role region 名，靠 selector）
- pattern: note items `section.note-item` 或 `section:has(a[href*="/search_result/"])` / `section:has(a[href*="/explore/"])`（#1507 兜底，class 漂时用 `<section>` 结构 + href substring）
- testid: 站内基本无 `data-testid`，靠 class + href substring 锚定
- text: search input placeholder `搜索小红书`；搜索按钮 visible text `搜索`；login wall 文案 `登录后查看搜索结果` / `请登录`
- selector_pattern: search submit URL pattern `/search_result/?keyword=<encoded>`

## Actions

```yaml
### action:run_search
pre: on /, logged_in
do: opencli xiaohongshu search "<keyword>" || (focus input[placeholder*="搜索小红书"] + type + Enter)
post: URL -> /search_result/?keyword=<encoded>; note grid rendered
fail: stays on / | "登录后查看搜索结果" overlay | empty results panel
recover: adapter_health_update: opencli xiaohongshu search -> suspect; check whoami; persistent empty -> workflows/search.md Fallback
evidence: opencli xiaohongshu search
```

```yaml
### action:scroll_feed
pre: on / OR /explore OR /search_result/, feed loaded
do: evaluate("window.scrollBy(0, window.innerHeight * 2)")
post: 更多 section.note-item 追加 DOM
fail: 2s 无新 entry | 安全限制 toast | URL 切到 /login
recover: wait 2s retry; 持续无新 entry -> 已到尾 OR 触发 security_block，停手
evidence: opencli browser evaluate
```

## Note card actions

每张 note card 上的 open / 提取 link 是跨页通用，定义在 [`pages/_note_card.md`](./_note_card.md)。

- use `action:open_note in pages/_note_card.md`
- use `action:read_card_meta in pages/_note_card.md`

## Page pitfalls

- `/` 与 `/explore` 是同一 feed，不同 url 不同 referer 行为但 DOM 一致
- `/search_result/?keyword=<encoded>` 关键词必须 URL-encode（含中文 / 空格）
- 未登录访问 `/explore` 或 `/search_result/` 大概率 redirect `/login` 或叠 login wall overlay — `pitfall:login_wall_on_most_routes`
- search API 已 broken，adapter 走 DOM scrape — `pitfall:search_api_returns_empty`
