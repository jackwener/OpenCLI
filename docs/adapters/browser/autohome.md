# 汽车之家 Autohome

**Mode**: 🌐 Public · **Domain**: `autohome.com.cn`

No login, no cookies, no signature. Reads two fully server-rendered sources:
the brand catalog (`grade/carhtml/<INITIAL>.html`) and the 口碑 page
(`k.autohome.com.cn/<seriesId>`, whose `__NEXT_DATA__` carries the aggregate
rating).

## Commands

| Command | Description |
|---------|-------------|
| `opencli autohome brand <品牌>` | A brand's car series + 厂商指导价 (guide price) |
| `opencli autohome score <series_id>` | 口碑 rating: overall + per-dimension + 故障率PPH + competitors |

`score` takes a **series_id** from `brand` (the `series_id` column) or a
`https://k.autohome.com.cn/<id>` URL.

## Usage Examples

```bash
# A brand's whole lineup with guide prices
opencli autohome brand 宝马
opencli autohome brand 比亚迪 --limit 80
opencli autohome brand 理想

# Owner-rating summary for a series
opencli autohome score 6548        # 宝马X5

# JSON output
opencli autohome brand 丰田 -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `brand` | `series_id, name, price, url` |
| `score` | `field, value` (series_id, name, brand, level, guide_price, overall, 各维度评分…, pph_每百车故障, review_users, competitors, url) |

## Notes & Limits

- **Search is by brand, not free text.** Autohome's keyword-search and the
  per-trim config JSON are app-signature gated; the brand catalog is the
  login-free entry point, so you search by brand (e.g. 宝马 / 比亚迪 / 理想) and
  drill into a series from there. For free-text model search, use
  `dongchedi search`.
- **`brand` accepts known Chinese brand names** (mapped to the catalog's pinyin
  initial) or a single A-Z catalog letter. Unknown brands raise a clear error
  rather than guessing.
- **`score` is the aggregate rating only.** The per-review owner-text list loads
  from a separate signed XHR and is intentionally not scraped (use
  `dongchedi koubei` for owner review bodies).
- **Full per-trim config (参数配置) is not offered** — Autohome's config page
  obfuscates values with a rotating CSS font glyph map, which can't be read
  reliably from plain HTTP; faking partial specs would be worse than omitting
  them. Use `dongchedi specs` for a config overview.

## Prerequisites

None — public site, no authentication required.
