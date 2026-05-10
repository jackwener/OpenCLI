# dianping

**Mode**: 🔐 Browser · **Domain**: `www.dianping.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli dianping search "<keyword>" --city <name-or-id> --limit <n>` | Search shops/restaurants on `www.dianping.com` |
| `opencli dianping shop <shop_id>` | Read shop detail by shop id (alias: `detail`) |

## Usage Examples

```bash
# Search "火锅" in 北京 (top 5 results, table view)
opencli dianping search 火锅 --city beijing --limit 5

# JSON output
opencli dianping search 火锅 --city 北京 --limit 5 -f json

# Search using a numeric cityId (path segment in dianping URLs)
opencli dianping search 火锅 --city 2

# Search using the cookie's currently-selected city (omit --city)
opencli dianping search 火锅

# Read a shop detail by id
opencli dianping shop GxJZ4urc9TnKE3kY

# `detail` alias works the same way
opencli dianping detail GxJZ4urc9TnKE3kY -f json

# Pass a full /shop/<id> URL — the id segment is auto-extracted
opencli dianping shop https://www.dianping.com/shop/GxJZ4urc9TnKE3kY
```

## Prerequisites

- Chrome running and **logged into** `dianping.com`
- [Browser Bridge extension](/guide/browser-bridge) installed
- The PC site (`www.dianping.com`) is the primary target. The mobile site
  (`m.dianping.com`) is intentionally crippled for non-mobile UAs and is not
  used by these adapters.

## Notes

- `search --limit` is between 1 and 15 (dianping fixed page size). Default is 15.
- `--city` accepts a Chinese name (`北京`/`上海`), pinyin (`beijing`/`shanghai`),
  or a numeric `cityId`. When omitted, the cookie's currently-selected city is
  used.
- `search` columns: `rank, shop_id, name, rating, reviews, price, cuisine, district, url`.
  `shop_id` round-trips into `dianping shop`.
- `shop` returns a `field, value` sheet so missing fields surface as `null`
  rather than fabricated values. The phone number is intentionally hidden on
  the PC web (only revealed in the native app), so it is not included.

## Troubleshooting

- If you hit a captcha redirect to `verify.meituan.com` (icon-tap challenge),
  the adapter will throw `AUTH_REQUIRED` with the captcha URL. Open the URL
  manually in the same Chrome profile, solve the captcha, then retry.
- If `dianping shop` fails with `EMPTY_RESULT`, the shop may have been removed
  or relocated; verify the id by visiting `https://www.dianping.com/shop/<id>`
  in the browser.
- If `dianping search` returns zero rows, try a more specific keyword or a
  different city — dianping's search is keyword-coverage dependent.
