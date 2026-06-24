# 太平洋电脑网 PConline

**Mode**: 🌐 Public (4 commands) + 🔐 Browser (`search`) · **Domain**: `product.pconline.com.cn`

No login, no cookies, no signature. PConline (太平洋电脑网) runs one of China's
oldest digital-product catalogues (产品库) — phones, laptops, cameras, CPUs,
GPUs, tablets, watches, etc. Every 产品库 page is plain server-rendered HTML,
**GBK-encoded and gzip'd**. Each command does a plain HTTP GET (Node's `fetch`
inflates the gzip), decodes the GBK bytes with `TextDecoder('gbk')`, and parses
the HTML — there is no JSON blob and no anti-bot token on these pages.

## Commands

| Command | Description |
|---------|-------------|
| `opencli pconline search <keyword>` | 🔐 Keyword search (快搜) → name + 报价 + detail URL — needs a logged-in browser |
| `opencli pconline list <category>` | Browse a category (产品大全) → name + 参考价 + detail URL |
| `opencli pconline info <product>` | Product overview: 名称 / 分类 / 品牌 / 重点参数 |
| `opencli pconline param <product>` | Full spec sheet (参数): screen, battery, chipset, ports… |
| `opencli pconline price <product>` | Price history: 历史最低价 + 京东/苏宁 latest tracked price |

`info` and `param` take a **product reference** — the detail URL from `list`
(e.g. `product.pconline.com.cn/mobile/apple/2718819.html`) or the bare
`<category>/<brand>/<id>` triple. Unlike some sister sites, the numeric id
**alone is not enough** (PConline can't resolve a product from the id only), so
pass the full URL `list` prints.

`list` is the discovery entry point. Common category slugs:

| slug | 品类 | slug | 品类 |
|------|------|------|------|
| `mobile` | 手机 | `cpu` | 处理器 |
| `notebook` | 笔记本 | `vga` | 显卡 |
| `tabletpc` | 平板电脑 | `dc` | 数码相机 |
| `smartwatch` | 智能手表 | `monitor` | 显示器 |

## Usage Examples

```bash
# Keyword search (needs a logged-in Chrome via the browser bridge)
opencli pconline search "iPhone 15" --limit 5

# …or browse a category to discover products + their URLs (no browser needed)
opencli pconline list mobile --limit 10
opencli pconline list notebook

# Overview of a product (paste the url from list)
opencli pconline info product.pconline.com.cn/mobile/apple/2718819.html

# …or the bare triple
opencli pconline info mobile/apple/2718819

# Full parameter sheet
opencli pconline param mobile/apple/2718819

# Price history (accepts a bare id too)
opencli pconline price 2718819
```

## Notes

- **GBK + gzip** — handled internally; output is UTF-8.
- **`list`** scopes to the `#JlistItems` product grid (so the page's filter
  controls aren't scraped), dedupes by product id and caps at `--limit`
  (default 20, max 60). `price` is `null` when PConline shows 暂无经销商报价.
- **`info`** reads the product `<h1>`, the breadcrumb (分类 / 品牌) and the
  重点参数 highlight block; each highlight's clean value comes from the span's
  `title` attribute, falling back to the text after the `：`.
- **`param`** pairs each `<th>` with its `<td>` inside `area-detailparams`;
  glossary popups (`<div class="tips">…是什么 / 查看所有…</div>`) and the CPU/GPU
  "点击型号查看完整天梯图" affordance are stripped so only real spec values remain.
- **`price`** calls the public JSON API `ppc.pconline.com.cn/productPrice/list`
  (a separate host from the rate-limited 产品库, keyed by the numeric id alone,
  so it accepts a bare id). It returns the 历史最低价 plus each mall's latest
  tracked price; malls with no data points are simply omitted.
- **`search`** is the one **browser** command. 快搜 (`ks.pconline.com.cn`) sits
  behind a slide-captcha anti-bot challenge, so a plain fetch gets HTTP 503 — it
  only renders in a real browser. So `search` drives the browser bridge
  (`Strategy.COOKIE`, `browser: true`), lets the SSR results render, and parses
  each `.item-wrap` card (`.item-name[title]` + `.item-pic` detail link + ￥price)
  out of the DOM. The anti-bot is **not** a login gate — but a logged-in Chrome
  is the reliable way to have the challenge already cleared. If you don't want a
  browser, `list` covers discovery with a plain fetch.
- **Why no `comment`?** The 点评 API (`pdcmt…/mtp-list.jsp`) returns empty
  shells, so it's left out — the adapter never ships empty/unreliable data.
