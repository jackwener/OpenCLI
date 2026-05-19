# Booking.com

**Mode**: 🔓 Public (browser) · **Domain**: `www.booking.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli booking search` | Search hotels by destination + check-in/check-out dates |

## Usage Examples

```bash
# Basic — 2 adults, 1 room, default Booking page size (25 results)
opencli booking search Tokyo --checkin 2026-06-15 --checkout 2026-06-17

# Force result locale and currency
opencli booking search Paris --checkin 2026-07-01 --checkout 2026-07-03 \
  --lang en-us --currency USD

# Family stay — 2 adults + 2 children, 1 room
opencli booking search Singapore --checkin 2026-06-15 --checkout 2026-06-20 \
  --adults 2 --children 2

# Paginate (Booking pages 25 per request)
opencli booking search Tokyo --checkin 2026-06-15 --checkout 2026-06-17 --offset 25

# JSON output for downstream tooling
opencli booking search Tokyo --checkin 2026-06-15 --checkout 2026-06-17 -f json
```

## Output

### `search`

| Column | Type | Notes |
|--------|------|-------|
| `rank` | int | 1-based position within this query (carries `--offset` so paginated calls stay sortable) |
| `name` | string | Hotel display name. May be localized by browser session cookies — see *Locale handling* below |
| `country` | string | ISO-3166 alpha-2 country code parsed from URL path |
| `slug` | string | URL path slug — stable cross-locale identifier, round-trips into the canonical detail URL |
| `star_rating` | int \| null | Booking star rating (1–5). `null` is common — Booking renders stars inconsistently on listing cards |
| `review_score` | float \| null | Aggregate guest score on a 1.0–10.0 scale (e.g. `8.6`) |
| `review_count` | int \| null | Number of reviews backing the score |
| `price_amount` | float \| null | Final per-stay price as a plain number, in `price_currency` |
| `price_currency` | string \| null | ISO 4217 currency code. Pass `--currency USD` (or similar) to set Booking's `selected_currency` and force a stable output code |
| `distance` | string \| null | Distance-from-centre string (locale-formatted, e.g. `3.4 km from centre` / `离中心地区3.4千米`) |
| `recommended_room` | string \| null | Recommended room type + bed config + amenity/urgency hints, concatenated as Booking ships them |
| `url` | string | Canonical `https://www.booking.com/hotel/<country>/<slug>.html` |

`null` semantics: a `null` field means Booking did not expose that field for
this card (e.g. some listings have no star rating, no review count yet, or no
price displayed because dates are unavailable). Failures (page failed to
render, captcha challenge) raise typed errors instead of silently returning
empty rows.

## Validation (no silent clamp)

- `--checkin` / `--checkout` must be `YYYY-MM-DD`; checkout must be strictly after checkin.
- `--adults` `1..30`, `--rooms` `1..30`, `--children` `0..10` — out-of-range throws `ArgumentError` (no silent clamp).
- `--limit` `1..100`, `--offset` `0..1000` — out-of-range throws `ArgumentError`.
- `--lang` must be one of the supported Booking locales (e.g. `en-us`, `zh-cn`, `ja`, `ko`, `de`, `fr`, `es`); anything else throws `ArgumentError`.
- `--currency` must be a 3-letter ISO 4217 code (`USD`, `JPY`, `CNY`, …); symbols like `US$` throw `ArgumentError`.

## Locale handling

The URL path encodes the requested locale (`searchresults.<lang>.html`) and
`selected_currency` forces ISO 4217 price symbols. **But** bound browser
session cookies can still override hotel name strings to the user's preferred
language even when `--lang en-us` is set. The `slug`, `url`, `country`, and
numeric fields stay stable regardless — prefer `slug` (not `name`) as the
round-trip key. When `--currency` is provided and Booking renders a price,
the adapter reports that requested ISO code instead of guessing from ambiguous
symbols such as `$` or `¥`.

## Anti-bot

Booking serves a `/captcha` verification page after sustained scraping. The
adapter detects this via title / body text inspection and raises
`CommandExecutionError` instead of silently returning empty rows. If you hit
this, slow your call rate or change browser profile / IP.

## Notes

- Strategy: `Strategy.PUBLIC` + `browser: true`. No login required.
- Booking's search results are server-rendered HTML; the adapter scrapes
  `[data-testid=property-card]` cards via `page.evaluate(EXTRACTOR)`. The
  `[data-testid]` attributes are stable, but layout details change
  occasionally.
- The score block renders score text duplicated as `8.68.6` (a11y + visual
  copies); the extractor anchors on the first `(\d{1,2})\.(\d)` capture to
  avoid mis-parsing `8.6` as `8.68`.
