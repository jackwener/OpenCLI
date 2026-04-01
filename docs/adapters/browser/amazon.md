# Amazon

**Mode**: 🔐 Browser · **Domain**: `amazon.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli amazon bestsellers [<best-sellers-url>]` | Read Amazon Best Sellers pages for ranked candidate discovery |
| `opencli amazon search "<query>"` | Read Amazon search results for coarse filtering |
| `opencli amazon product <asin-or-url>` | Read a product page with title, price, rating, breadcrumbs, and bullets |
| `opencli amazon offer <asin-or-url>` | Read seller / fulfillment / buy-box facts from the product page |
| `opencli amazon discussion <asin-or-url>` | Read review summary and sample customer reviews |

## Usage Examples

```bash
# Root Best Sellers page
opencli amazon bestsellers https://www.amazon.com/Best-Sellers/zgbs --limit 10 -f json

# Category-specific Best Sellers page
opencli amazon bestsellers "<category-best-sellers-url>" --limit 50 -f json

# Search products
opencli amazon search "desk shelf organizer" --limit 20 -f json

# Validate one product
opencli amazon product B0FJS72893 -f json

# Validate seller / offer facts
opencli amazon offer B0FJS72893 -f json

# Read review summary + samples
opencli amazon discussion B0FJS72893 --limit 5 -f json
```

## Prerequisites

- Chrome running with an active `amazon.com` session in the shared profile
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- This adapter only returns fields visible on public Amazon pages.
- `bestsellers` and `search` are for candidate discovery; `product`, `offer`, and `discussion` are the validation surfaces.
- `offer` is the right surface for `sold_by`, `ships_from`, and Amazon-retail exclusion.
- `discussion` may return review data even when Q&A is absent. Missing Q&A is a normal outcome, not an error.

## Troubleshooting

- If Amazon shows a robot-check page, clear it in Chrome and retry.
- If CDP is attached to the wrong tab, retry with `OPENCLI_CDP_TARGET=amazon.com`.
- Avoid running multiple Amazon browser commands in parallel against the same shared Chrome target.
