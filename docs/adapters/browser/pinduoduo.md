# Pinduoduo (拼多多)

**Mode**: 🔐 Browser · **Domain**: `mobile.yangkeduo.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli pinduoduo search <query>` | Search products from the H5 search page (first server-rendered page, up to 20 items) |

## Usage Examples

```bash
# Search products
opencli pinduoduo search 手机壳 --limit 5

# JSON output
opencli pinduoduo search 保温杯 -f json
```

## Output

| Column | Meaning |
|--------|---------|
| `price` | Price shown on the search card (after coupon when `price_label` is `券后`) |
| `price_label` | Prefix shown next to the price, e.g. `券后`; empty when none |
| `group_price` | Pre-coupon group-buy price in yuan |
| `goods_id` | Product ID, used in `url` |

## Prerequisites

- Chrome running and **logged into** mobile.yangkeduo.com
- [Browser Bridge extension](/guide/browser-bridge) installed

## Limits

- Only the first server-rendered page is read, so `--limit` is capped at 20.
- Sorting and paging run through a client-side request with risk-control fields and are not supported.
