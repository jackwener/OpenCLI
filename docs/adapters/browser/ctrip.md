# Ctrip (携程)

**Mode**: 🌐 Public (`search`, `hotel-suggest`) · 🖥️ Browser + Cookie (`hotel-search`, `flight`)
**Domain**: `ctrip.com`

Public destination + hotel-context suggestion lookup against the
`m.ctrip.com/restapi/soa2/21881/json/gaHotelSearchEngine` endpoint plus
browser-driven hotel listing and one-way flight search on `hotels.ctrip.com`
and `flights.ctrip.com`.

## Commands

| Command | Mode | Description |
|---------|------|-------------|
| `opencli ctrip search` | Public | Suggest cities, scenic spots, railway stations and landmarks |
| `opencli ctrip hotel-suggest` | Public | Suggest cities, business areas and individual hotels |
| `opencli ctrip hotel-search` | Browser (cookie) | List hotels for a city + check-in/out date range |
| `opencli ctrip flight` | Browser (cookie) | One-way flight search by IATA route + departure date |

## Usage Examples

```bash
# Destination suggest
opencli ctrip search 苏州 --limit 10

# Hotel-context suggest (cities / business areas / hotels)
opencli ctrip hotel-suggest 陆家嘴 --limit 5

# Hotel listing (city ID from `search` / `hotel-suggest`)
opencli ctrip hotel-search 2 --checkin 2026-05-20 --checkout 2026-05-21 --limit 10

# One-way flight search
opencli ctrip flight BJS SHA --date 2026-05-20 --limit 20

# JSON output
opencli ctrip search 上海 -f json
```

## Suggest Columns (`search` / `hotel-suggest`)

Both suggest commands share a uniform column shape:

| Column | Notes |
|--------|-------|
| `rank` | 1-based position in the upstream list |
| `id` | Upstream entity id (round-trips into URL) |
| `type` | Raw type tag (`City` / `Markland` / `Hotel` / `BusinessArea` / `RailwayStation`) |
| `displayType` | Localised label (城市 / 地标 / 酒店 / 商圈 / 火车站) |
| `name` | Localised display name |
| `eName` | English name (may be empty) |
| `cityId`, `cityName`, `provinceName`, `countryName` | Geo context |
| `lat`, `lon` | Best-available coords (gaode → google → flat → null) |
| `score` | First non-zero of `commentScore` / `cStar`; `null` if both unrated |
| `url` | Canonical Ctrip URL or `null` if the entity type has no public web page |

`--limit` accepts integers in `[1, 50]`. Out-of-range values raise
`ArgumentError` (no silent clamp).

## Hotel Listing Columns (`hotel-search`)

| Column | Notes |
|--------|-------|
| `rank` | 1-based position in upstream list |
| `hotelId` | Round-trips into `https://hotels.ctrip.com/hotels/detail/?hotelid=…` |
| `name`, `enName` | Localised + English (English may be `null`) |
| `star` | `1`-`5`, `null` for unrated / 客栈 entries |
| `score`, `scoreLabel` | e.g. `4.8` / `"超棒"`; both `null` if unrated |
| `reviewCount` | Integer parsed from `"13,966条点评"` |
| `cityName`, `district`, `address` | Geo context |
| `lat`, `lon` | WGS84 (1) > GCJ02 (2) > BD09 (3) selection; `null` if all are 0 |
| `price`, `currency` | First room's quote; `null` when no rooms remain at the searched date |
| `url` | Canonical detail URL or `null` if `hotelId` is missing |

Args:
- `<city>` (positional, required) — numeric Ctrip city ID (discover via `ctrip search` / `ctrip hotel-suggest`).
- `--checkin`, `--checkout` (required) — `YYYY-MM-DD`, validated as real calendar dates with `checkin < checkout`.
- `--limit` (1-30, default 10) — Ctrip's SSR first page ships ~13 entries (10 organic + ~3 promoted). Larger limits are not currently supported because the server ignores the URL `pageSize` param.

## Flight Columns (`flight`)

| Column | Notes |
|--------|-------|
| `rank` | 1-based position after filtering incomplete rows |
| `airline`, `flightNo`, `aircraft` | Free-text from the rendered card; `aircraft` may be `null` |
| `departureTime`, `arrivalTime` | `HH:MM` strings |
| `departureAirport`, `arrivalAirport`, `terminal` | Airport names + optional `T1`/`T2` chunk |
| `price`, `currency`, `cabin` | First quoted fare; `cabin` is the Chinese suffix (e.g. `经济舱`) |
| `url` | The search URL (Ctrip's flight cards don't expose per-row stable deeplinks) |

Args:
- `<from>`, `<to>` (positional, required) — 3-letter IATA codes; `BJS`/`SHA` metro codes work alongside single-airport codes like `PEK`/`PVG`.
- `--date` (required) — `YYYY-MM-DD`.
- `--limit` (1-50, default 20).

Rows are extracted from `.flight-list > span > div` cards because Ctrip's
post-load XHR is not currently captured by the daemon network buffer (see
"Caveats" below). Cards with missing departure/arrival/airline are dropped
rather than emitted with sentinel values.

## Notes

- Suggest endpoint discriminator: `searchType=D` (search) vs `searchType=H`
  (hotel-suggest). Hotel and BusinessArea rows only appear in the `H` flavour.
- Mainland China suggest rows ship `gdLat`/`gdLon` (gaode). International rows
  ship `gLat`/`gLon` (wgs84). The adapter picks the first non-zero pair.
- Suggest in-band `Result: false` envelopes are surfaced as `COMMAND_EXEC`
  typed errors; HTTP non-2xx becomes `FETCH_ERROR`.

## Caveats (browser-mode commands)

- **Cookie required**: `hotel-search` / `flight` use `Strategy.COOKIE` against
  `hotels.ctrip.com` / `flights.ctrip.com`. If Ctrip serves a captcha redirect
  (suspected bot), an `AuthRequiredError` is raised — complete the captcha in
  your live browser session and retry.
- **No per-flight deeplink**: Ctrip's flight cards funnel every row through a
  shared booking handoff. Until a stable per-flight `bookingId` surfaces, all
  rows share the search URL.
- **Round-trip + airline-filter unsupported**: `flight` is one-way only and
  passes `cabin=Y_S_C_F` (all cabins) in v1. Round-trip + advanced filters
  tracked in the `#1481` follow-up.
- **Hotel SSR page size is server-fixed**: passing `&pageSize=N` is ignored
  upstream — first page returns ~13 rows. Larger result sets would need
  scroll-paginated DOM extraction (not implemented in v1).
