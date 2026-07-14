# 瓜子二手车 Guazi

**Mode**: 🌐 Public · **Domain**: `guazi.com`

No login, no cookies, no signature. Reads the **mobile** site `m.guazi.com`,
which server-renders the full listing list and car detail into the HTML (the
desktop `www.guazi.com` SPA loads data from a signature-locked API and is not
usable from a plain HTTP client).

## Commands

| Command | Description |
|---------|-------------|
| `opencli guazi browse [city]` | Used cars for sale in a city → price / mileage / year |
| `opencli guazi search <brand> [--city]` | Used cars filtered by **brand** in a city → price / mileage / year |
| `opencli guazi car <clue_id>` | One listing's detail → price, registration, mileage, specs, condition |

`car` takes a **clue_id** — get one from `browse`/`search` (the `clue_id` column)
or paste a `https://m.guazi.com/car-detail/c<id>.html` URL.

`search` takes a **brand** — a Chinese brand name (宝马 / 比亚迪 / 理想 / 特斯拉 …)
or a Guazi brand slug (`bmw` / `byd` / `lixiang` …). It hits the brand-filtered
mobile path `m.guazi.com/<city>/<brand>/`, which is server-rendered just like the
city page — so it needs no login or signature either.

## Usage Examples

```bash
# Browse listings (defaults to Beijing)
opencli guazi browse
opencli guazi browse 上海 --limit 30
opencli guazi browse sz            # city code also works

# Search by brand (defaults to Beijing)
opencli guazi search 宝马
opencli guazi search 比亚迪 --city 上海 --limit 30
opencli guazi search byd          # brand slug also works

# One listing in detail
opencli guazi car 168029452296957
opencli guazi car https://m.guazi.com/car-detail/c168029452296957.html

# JSON output
opencli guazi browse 北京 -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `browse` | `rank, clue_id, title, price, down_payment, mileage, year, city, url` |
| `search` | `rank, clue_id, title, price, down_payment, mileage, year, city, url` |
| `car` | `field, value` (clue_id, title, tag, price, reg_date, mileage, transfers, source_city, color, engine, gearbox, drivetrain, emission, condition, listing_no, url) |

## Cities

Pass a Chinese city name or a Guazi city code. Known names:
北京(bj), 上海(sh), 广州(gz), 深圳(sz), 杭州(hz), 成都(cd), 重庆(cq), 南京(nj),
武汉(wh), 天津(tj), 西安(xa), 苏州(su), 郑州(zz), 长沙(cs), 青岛(qd), 沈阳(sy),
大连(dl), 济南(jn), 合肥(hf), 佛山(fs). Any two/three-letter code is passed through
as-is, so other cities work by code too.

## Notes & Limits

- **First SSR page only.** Deep pagination, free-text keyword search, and
  multi-filter combos (price band + level + energy …) route through Guazi's
  signed `mapi.guazi.com` API, so `browse`/`search` each return the first
  server-rendered page (~40 fresh listings). Listings rotate, so re-running
  surfaces new cars rather than the same page. Single-**brand** filtering is the
  exception — it has its own SSR path (`/<city>/<brand>/`), which `search` uses.
- **Sparse inventory broadens region.** For a brand with little stock in the
  chosen city, Guazi pads the brand page with nearby/national listings; the
  `city` column always reflects each car's real location, so the result is never
  silently mislabeled.
- **Condition is a summary**, not the full inspection checklist (基础车况 +
  accident/transfer flags). The full 检测报告 sits behind the signed API and is
  intentionally not faked.
- If Guazi ever pushes the mobile pages behind their anti-bot challenge, the
  commands fail loudly with an auth-required error rather than returning blanks.

## Prerequisites

None — public site, no authentication required.
