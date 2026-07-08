# Coupang

**Mode**: 🔐 Browser · **Domain**: `coupang.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli coupang search` | Search Coupang products with logged-in browser session |
| `opencli coupang product` | Read full product detail (price, rating, seller, delivery) for a product ID |
| `opencli coupang add-to-cart` | Add a product to the logged-in account's shopping cart |

## Usage Examples

```bash
# List rocket-shipping mice (rank, product_id, title, price, rating, ...)
opencli coupang search "마우스" --filter rocket --limit 10

# Round-trip: pick a product_id from search and pull full detail
opencli coupang product 7654321

# Pass a full product URL instead of an ID
opencli coupang product --url https://www.coupang.com/vp/products/7654321

# JSON output (any subcommand)
opencli coupang product 7654321 -f json

# Add to cart (write — must be logged in)
opencli coupang add-to-cart 7654321
```

## Output

### `search`

| Column | Type | Notes |
|--------|------|-------|
| `rank` | int | 1-based position within this query / page |
| `product_id` | string | Numeric Coupang product id; round-trips into `coupang product` |
| `title` | string | Product display name |
| `price` | int \| null | Current selling price (KRW) |
| `unit_price` | string | Per-unit price label, e.g. `(100ml당 1,200원)` |
| `rating` | float \| null | Average star rating |
| `review_count` | int \| null | Number of reviews |
| `rocket` | string | Coupang-rocket badge label (`로켓배송` / `로켓와우` / etc.) — empty string if no badge |
| `delivery_type` | string | `무료배송` / `일반배송` / empty |
| `delivery_promise` | string | `오늘도착` / `내일도착` / `새벽도착` / empty |
| `url` | string | Canonical product URL |

### `product`

Always returns a single row (or throws):

| Column | Type | Notes |
|--------|------|-------|
| `product_id` | string | Numeric Coupang product id, normalised from input |
| `title` | string \| null | Product display name; `null` if upstream did not provide |
| `price` | int \| null | Current selling price (KRW) |
| `original_price` | int \| null | Pre-discount price |
| `discount_rate` | int \| null | Discount percent |
| `rating` | float \| null | Average star rating |
| `review_count` | int \| null | Number of reviews |
| `seller` | string \| null | Vendor / seller name |
| `brand` | string \| null | Brand label (when listed) |
| `rocket` | string \| null | Coupang-rocket type label |
| `delivery_promise` | string \| null | Arrival-window label |
| `image_url` | string \| null | Primary product image |
| `url` | string | Canonical product URL |

`null` semantics: a `null` field means upstream did not expose that field on
this product (e.g. some items have no `original_price`). Failures (login wall,
page mismatch, page failed to render) raise typed errors instead of silently
returning empty rows — callers should treat any returned row as real data.

### `add-to-cart`

| Column | Type | Notes |
|--------|------|-------|
| `ok` | bool | Always `true` on success (failures throw) |
| `product_id` | string | Coupang product id added |
| `url` | string | Canonical product URL |
| `message` | string | `Added to cart` |

## Validation (no silent clamp)

`search --limit` must be `1..50`; out-of-range values throw `ArgumentError`
(no silent clamp to 50). `search --page` must be a positive integer. `search
--filter` currently only accepts `rocket`; any other value throws
`ArgumentError` rather than being silently dropped during DOM lookup.

## Prerequisites

- Chrome running and **logged into** coupang.com
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `search` and `product` use the logged-in browser session because Coupang's
  `/np/search` JSON endpoint and product pages serve different (and often
  empty) responses to anonymous traffic.
- `product`'s extractor tries three sources in order: JSON-LD Product schema,
  `window.__INITIAL_STATE__` / `__NEXT_DATA__` bootstrap globals, and finally
  a DOM fallback. The merged result is what's returned.
- Authentication failures raise `AuthRequiredError`; missing/empty results
  raise `EmptyResultError` with a helpful hint. No command silently returns
  `[]` when login is the actual reason.
