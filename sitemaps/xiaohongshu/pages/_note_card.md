---
schema_version: 1.1
page_id: _note_card
url_patterns: []
purpose: partial — actions on any note card (used by explore / search_result / profile / feed)
last_verified: 2026-06-04
source: global
---

> Partial：`_` 前缀 + 空 `url_patterns` = 跨页通用 UI。其他 page 通过 `action:<id> in pages/_note_card.md` 引用。

## Visual anchors

- pattern: `section.note-item` 或 `section:has(a[href*="/explore/"])` / `section:has(a[href*="/search_result/"])`（class 漂兜底）
- selector_pattern: card 内 `a[href*="/explore/"]` 是 note permalink（自带 `xsec_token` query）
- text: card 底部 like 计数 `.like-wrapper .count` / 标题 `.title` (search) / 用户名 `.author .name`

## Card scope rule（全 action 共享）

所有 selector 必须 scoped 到 card root `section.note-item, section:has(a[href*="/explore/"])`，**不能** 用 page-level first match，否则点到 grid 首张非 target card。

## Actions

```yaml
### action:open_note
pre: card visible in viewport
do: click section a[href*="/explore/"] (scoped to this card) || evaluate href then goto
post: URL -> /explore/<note_id>?xsec_token=...; pages/note.md loaded
fail: stays on listing | modal not nav | 403 / security_block
recover: 直接 evaluate href 拿完整带 `xsec_token` URL 后 goto；href 不含 xsec_token -> pitfall:note_url_requires_xsec_token，跳过该 card
evidence: opencli browser click + state
```

```yaml
### action:read_card_meta
pre: card visible
do: evaluate("(c => ({title:c.querySelector('.title')?.innerText, like:c.querySelector('.like-wrapper .count')?.innerText, href:c.querySelector('a[href*=\"/explore/\"]')?.href}))(arguments[0])")
post: 返 {title, like, href}；href 自带 xsec_token
fail: 空对象 / title undef
recover: card 漂版，回 explore.md Page pitfalls 看 selector 变体；fallback workflow 走 adapter `feed` / `search` 直接拿结构化数据
evidence: opencli browser evaluate
```

## Pitfalls inherited

- 不要从 card 拿到 note_id 后手拼 `/explore/<note_id>`，必须用 card 原始 href — `pitfall:note_url_requires_xsec_token`
- 不要 page-level `document.querySelector('.title')` 拿"当前 card" — 全 grid 首张匹配
