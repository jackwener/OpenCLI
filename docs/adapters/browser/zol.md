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
| `opencli zol rank [category]` | Hot-product rankings (排行榜) — discover popular product ids without a keyword |
| `opencli zol param <product>` | Full spec sheet (参数): dimensions, screen, battery, chipset… |
| `opencli zol price <product>` | Live e-commerce 报价 — each platform/seller + price + buy link |
| `opencli zol koubei <product>` | User reviews (口碑): score + 续航/拍照/性能/外观 subscores + body |
| `opencli zol pic <product>` | Product image gallery (图片) — 外观图 / 细节图 URLs |

`param`, `price`, `koubei` and `pic` take a **product id** — get one from
`search` (the `product_id` column), from `rank`, or paste a
`https://detail.zol.com.cn/.../index<id>.shtml` URL. The subcategory segment in
ZOL detail URLs is cosmetic, so only the numeric product id matters.

`rank` needs no id at all — it's the discovery counterpart to `search`: it lists
ZOL's 热门排行 boards (手机 / 笔记本 / 显示器 / 空调 / 相机 …), each row carrying
a `product_id` you can feed straight into the other commands.

## Usage Examples

```bash
# Find a product
opencli zol search "iPhone 15" --limit 5
opencli zol search "ThinkPad X1"

# …or discover popular ones without a keyword
opencli zol rank 手机 --limit 10
opencli zol rank            # all boards (手机 / 笔记本 / 显示器 …)

# Full parameters for a product id from search / rank
opencli zol param 1427365

# Live merchant prices (京东 / 天猫 / 淘宝 …)
opencli zol price 1427365

# User reviews + per-aspect scores
opencli zol koubei 1427365 --limit 10

# Image gallery
opencli zol pic 1427365 --limit 20
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
- **`koubei`** reads the `review.shtml` 口碑 page; the `<em style="width:NN%">`
  star bar is mapped to a 0–5 `score`, the per-aspect spans to a `subscores`
  string, and the body is snippetted (`url` links the full write-up).
- **`pic`** anchors on the `imgwrap` gallery thumbnails (so unrelated product
  thumbnails on the page are excluded) and dedupes by image URL.
- **`rank`** has no login or id requirement — it parses the `top.zol.com.cn`
  `rank-module` boards, tags each row with its category, and drops the
  非-product 品牌排行榜 board automatically.
- **No login needed for any command.** Logging into ZOL only unlocks
  write/personalized features (posting reviews, 收藏, 关注, forums) — none of
  which are reproducible public data, so the adapter stays a pure anonymous
  `fetch`. All product data (specs, prices, user 口碑, images, rankings) is fully
  public SSR.
- `koubei` / `pic` resolve the product via the `/0/<id>/…` URL, which
  301-redirects to the canonical numeric subcategory; `fetch` follows it
  automatically.
