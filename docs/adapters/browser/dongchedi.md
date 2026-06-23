# 懂车帝 Dongchedi

**Mode**: 🌐 Public · **Domain**: `dongchedi.com`

No login, no cookies, no signature. Every command does a plain HTTP GET of a
server-rendered page and parses the `__NEXT_DATA__` JSON embedded in the HTML,
so it works out of the box.

## Commands

| Command | Description |
|---------|-------------|
| `opencli dongchedi search <keyword>` | Search car series by keyword → series + 指导价/经销商价 |
| `opencli dongchedi series <series_id>` | Series overview: brand, prices, 懂车分, sales rank, trim count |
| `opencli dongchedi models <series_id>` | Trims (款型) with guide / dealer / owner prices |
| `opencli dongchedi specs <series_id>` | Config overview: dimensions, powertrain, drivetrain, airbags |
| `opencli dongchedi score <series_id>` | 懂车分 rating — 8 axes vs same-class average |
| `opencli dongchedi koubei <series_id>` | Owner reviews (口碑): rating, trim bought, likes, full text |

`series`, `models`, `specs`, `score`, and `koubei` all take a **series_id** —
get one from `search` (the `series_id` column) or paste a
`https://www.dongchedi.com/auto/series/<id>` URL.

## Usage Examples

```bash
# Find a car series
opencli dongchedi search "宝马X5" --limit 5
opencli dongchedi search "汉兰达"

# One series at a glance (prices + 懂车分 + ranks)
opencli dongchedi series 5273

# Trims and their prices
opencli dongchedi models 5273
opencli dongchedi models 5273 --status offline   # discontinued trims

# Key configuration overview
opencli dongchedi specs 5273

# Rating breakdown vs same-class average
opencli dongchedi score 5273

# Owner reviews (full body in the content column)
opencli dongchedi koubei 5273 --limit 10

# JSON output
opencli dongchedi search "汉兰达" -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, series_id, name, brand, official_price, dealer_price, pictures, url` |
| `series` | `field, value` (series_id, name, brand, sub_brand, official_price, dealer_price, used_price, score, review_count, sale_rank, score_rank, models, url) |
| `models` | `car_id, name, year, official_price, dealer_price, owner_price` |
| `specs` | `field, value` (dimensions, wheelbase, power, engine, gearbox, energy, acceleration, drivetrain, suspension, airbags) |
| `score` | `dimension, score, same_level_avg` |
| `koubei` | `rank, user, car, score, likes, comments, content, url` |

Scores are rescaled to a 0–5 float (Dongchedi stores them as x100 ints; 422 → 4.22).

## Notes & Limits

- **Why SSR, not the JSON API:** Dongchedi's `/motor/...` XHR endpoints are
  ByteDance-signature gated (`a_bogus` / `X-Bogus`) and 404 without a valid
  signature. The SSR pages expose the same data unsigned, so this adapter reads
  those instead — no signature replication, no breakage when the signing scheme
  rotates.
- **`specs` is the overview, not the full parameter sheet.** The complete
  per-trim parameter table lives behind a signed XHR; rather than fabricate it,
  `specs` returns the unsigned SSR overview (dimensions, powertrain, drivetrain,
  suspension, airbags). For per-trim names/prices use `models`.
- **`koubei` is a single SSR page** (up to ~15 reviews). Deep pagination uses the
  signed API and is intentionally not implemented.

## Prerequisites

None — public site, no authentication required.
