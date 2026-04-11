# SCYS Schema Guidelines

This document defines JSON output conventions for `opencli scys` commands to keep `feed`, `opportunity`, `article`, and `read` consistent for pipeline consumers.

## 1) Canonical Naming

Use these canonical field names for the same semantics:

- `url`: canonical page/detail URL
- `raw_url`: original URL used to fetch data (before normalization/fallback)
- `images`: image URL list (`string[]`)
- `summary`: list/card preview text
- `content`: full detail text (detail pages)

Deprecated aliases (`link`, `raw_link`, `image_urls`, `preview`) are no longer part of canonical SCYS JSON output. New code must not reintroduce them.

## 2) Canonical Types

For all SCYS JSON outputs:

- `tags`: always `string[]`
- `flags`: always `string[]`
- `images`: always `string[]`
- `external_links`: always `string[]`
- `source_links`: always `string[]`
- `interactions`: always object:

```json
{
  "likes": 16,
  "comments": 0,
  "favorites": 4,
  "display": "点赞16 评论0 收藏4"
}
```

## 3) Structured vs Display Fields

Keep machine fields and display fields separate:

- Machine fields: `interactions.likes/comments/favorites`, `tags`, `flags`, `images`
- Display field: `interactions.display`
- Table-oriented helper fields (for CLI table only), e.g. `interactions_display`, are allowed but should mirror structured fields exactly.

## 4) List vs Detail Semantics

- List commands (`feed`, `opportunity`) should prioritize `summary`.
- Detail command (`article`) should prioritize `content`.
- Do not expose duplicated legacy aliases in normal command output.

## 5) Change Checklist

When adding or changing SCYS commands:

1. Reuse canonical field names and types from this document.
2. Do not add new semantic duplicates.
3. Keep `scys read` routing output schema aligned with direct command output.
4. Run `npm run typecheck` and adapter tests before commit.
5. If compatibility aliases are changed or removed, document it in PR notes explicitly.
