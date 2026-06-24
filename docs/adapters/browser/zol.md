# 中关村在线 ZOL

**Mode**: 🌐 Public · **Domain**: `zol.com.cn`

No login, no cookies, no signature. ZOL (ZhongGuanCun Online) is China's largest
digital-product catalogue — phones, laptops, cameras, etc. Every page is plain
server-rendered HTML, **GBK-encoded**, and is served only to a desktop
User-Agent + a zol referer (a mobile UA gets a 153-byte stub). Each command does
a plain HTTP GET, decodes the GBK bytes with `TextDecoder('gbk')`, and parses the
HTML — there is no JSON blob and no anti-bot token.

## Commands

| Command | Description |
|---------|-------------|
| `opencli zol search <keyword>` | Search products by keyword → name + 报价 + product id |
| `opencli zol param <product>` | Full spec sheet (参数): dimensions, screen, battery, chipset… |
| `opencli zol price <product>` | Live e-commerce 报价 — each platform/seller + price + buy link |

`param` and `price` take a **product id** — get one from `search` (the
`product_id` column) or paste a `https://detail.zol.com.cn/.../index<id>.shtml`
URL. The subcategory segment in ZOL detail URLs is cosmetic, so only the numeric
product id matters.

## Usage Examples

```bash
# Find a product
opencli zol search "iPhone 15" --limit 5
opencli zol search "ThinkPad X1"

# Full parameters for a product id from search
opencli zol param 1427365

# Live merchant prices (京东 / 天猫 / 淘宝 …)
opencli zol price 1427365
```

## Notes

- **GBK encoding** — handled internally; output is UTF-8.
- **`search`** dedupes by product id (the result list repeats the title and the
  per-variant anchors) and caps at `--limit` (default 20, max 40).
- **`param`** returns flat `field` / `value` rows pulled from the
  `newPmName_N` / `newPmVal_N` span pairs; ZOL's "查看…>" link-label chrome is
  stripped so only real spec values remain.
- **`price`** maps the platform slug (`brand-mol-jd` → 京东, `…-tmall` → 天猫,
  `…-taobao` → 淘宝, etc.) and returns the numeric price plus the merchant's buy
  link.
- Reviews/评测 and 口碑 (user reviews) are intentionally not included in this
  first cut — they live behind separate pages and can be added later.
