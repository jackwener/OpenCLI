---
schema_version: 1.1
workflow_id: search
intent: search for tweets / users / latest news by keyword
last_verified: 2026-06-02
source: global
---

## Goal

按关键词搜索 tweet / user / news 等，取结果列表前 N 条。

## State signature

- entry: 任意 page, logged_in (少数情况未登录也工作但结果稀缺)
- success: 落 `/search?q=<term>&src=typed_query`, timeline region 出现结果或 "No results"

## Best path

```yaml
adapter: opencli twitter search
adapter_health: healthy
preconditions:
  - logged_in
  - keyword query ready
optional:
  - filter (latest | top | people | photos | videos)
estimated_turns: 1
```

`opencli twitter search --query "<keyword>" [--type latest|top|people]`。adapter 内置 queryId bundle parse 三层降级（实现细节见 `notes.md`）。

## Fallback path

```yaml
on_adapter_fail:
  - adapter_health_update: opencli twitter search -> suspect
  - goto https://x.com/search?q=<URLencoded>&src=typed_query&f=live  # f=live = Latest tab
  - wait for [data-testid="cellInnerDiv"] OR text "No results for"
  - find tweet card list (each per pages/_tweet_card.md)
  - if more needed -> scroll (action:scroll_for_more in pages/home.md)
estimated_turns: 3-4
```

## Avoid

- 不要 `goto /search?q=...` 不带 `&src=typed_query` — 某些 query 会 redirect 到 trending detail 而非结果列表
- 不要硬编码 `&f=top` 期望 "top is relevance" — Twitter "Top" 是混合排序，task 多数需要 "Latest" (时间序) → `&f=live`
- 不要循环 click `"Show more"` UI button — 无限滚动模式，触发是 scroll 不是 click

## Re-entry checkpoints

- on /search?q=<term>, timeline 未渲染 → Fallback step 2 (wait)
- on /search?q=<term>, 第一页已显示 → 决定继续 scroll
- 已收集 N 条结果 → 完成

## State validation

- URL 含 `q=<keyword>` (URL-decode 后匹配输入)
- 结果列表非空 OR 明确 "No results for"
- 每条结果是 valid tweet card

## Stale markers

- search page tab 顺序 / labels 变 (Top / Latest / People / Media / Lists)
- `src=typed_query` query param 失效 → URL pattern 调整
- adapter `opencli twitter search` queryId bundle parser silent fail (PR #1531 sediment: bundle partial fail 返 `{}` 盖 baked fallback)
