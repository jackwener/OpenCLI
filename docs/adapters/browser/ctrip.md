# Ctrip (携程)

**Mode**: 🌐 Public (`search`, `hotel-suggest`) · 🖥️ Browser + Cookie (`hotel-search`, `hotel`, `flight`, `train`, `bus`, `ferry`)
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
| `opencli ctrip hotel` | Browser (cookie) | Single-hotel detail: rating breakdown, facilities, check-in/out policy |
| `opencli ctrip flight` | Browser (cookie) | One-way flight search by IATA route + departure date |
| `opencli ctrip train` | Browser (cookie) | Train ticket search by station/city name + departure date |
| `opencli ctrip bus` | Browser (cookie) | Intercity coach ticket search by city name + departure date |
| `opencli ctrip ferry` | Browser (cookie) | Passenger ferry sailing search by city name + departure date |

## Usage Examples

```bash
# Destination suggest
opencli ctrip search 苏州 --limit 10

# Hotel-context suggest (cities / business areas / hotels)
opencli ctrip hotel-suggest 陆家嘴 --limit 5

# Hotel listing (city ID from `search` / `hotel-suggest`)
opencli ctrip hotel-search 2 --checkin 2026-05-20 --checkout 2026-05-21 --limit 10

# Single-hotel detail (hotel id from `hotel-suggest`)
opencli ctrip hotel 375539
opencli ctrip hotel 375539 -f json

# One-way flight search
opencli ctrip flight BJS SHA --date 2026-05-20 --limit 20

# Train ticket search (station or city names)
opencli ctrip train 北京 上海 --date 2026-05-20 --limit 20
opencli ctrip train 杭州 上海虹桥 --date 2026-05-20 -f json

# Intercity coach ticket search (city names)
opencli ctrip bus 北京 天津 --date 2026-05-20 --limit 20

# Passenger ferry search (city names)
opencli ctrip ferry 大连 烟台 --date 2026-05-20 --limit 20

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

## Train Columns (`train`)

| Column | Notes |
|--------|-------|
| `rank` | 1-based position after filtering incomplete rows |
| `trainNo` | Train number (`G531` / `D701` / `K528`); the `.checi` icon suffix is stripped |
| `departureTime`, `arrivalTime` | `HH:MM` strings |
| `departureStation`, `arrivalStation` | Station names (e.g. `北京南`, `上海虹桥`) |
| `duration` | Trip length as shown (e.g. `5时56分`); `null` if absent |
| `fromPrice` | Lowest fare shown for the train as a number; `null` if non-numeric |
| `seats` | Seat-class availability joined by ` / ` (e.g. `二等座有票 / 一等座17张 / 商务座(抢)`) |
| `url` | The search URL (train rows share the list page, no per-row deeplink) |

Args:
- `<from>`, `<to>` (positional, required): Chinese station or city names (e.g. `北京` / `上海虹桥`); the list page resolves them the same way the website search box does.
- `--date` (required): `YYYY-MM-DD`.
- `--limit` (1-50, default 20).

Rows come from `.card-white.list-item` cards, read by stable class-keyed
fields (`.from/.mid/.to/.rbox/.surplus-list`) rather than positional innerText.
Cards missing the train number or endpoint times are dropped rather than
emitted with sentinel values.

## Bus Columns (`bus`)

| Column | Notes |
|--------|-------|
| `rank` | 1-based position after filtering incomplete rows |
| `departureTime` | `HH:MM` departure time |
| `fromStation`, `toStation` | Departure and arrival coach stations |
| `duration` | Trip length as shown (e.g. `约2时30分`); `null` if absent |
| `price` | Fare as a number; `null` if non-numeric |
| `status` | Availability text (e.g. `暂停网售`, or a remaining-ticket count) |
| `url` | The results URL (coach rows share the list page, no per-row deeplink) |

Args:
- `<from>`, `<to>` (positional, required): Chinese city names (e.g. `北京` / `天津`); the results page returns the station-level departures between them.
- `--date` (required): `YYYY-MM-DD`.
- `--limit` (1-50, default 20).

The `bus.ctrip.com/` landing is a client-only SPA that does not hydrate under
the browser bridge, so the command navigates the results route directly via its
`?param=<json>` deep link. Coach rows arrive through the `busListV2` XHR and are
read from `.list-item-parent` cards by stable utility-class fields rather than
positional innerText.

## Ferry Columns (`ferry`)

| Column | Notes |
|--------|-------|
| `rank` | 1-based position after filtering incomplete rows |
| `shipName` | Vessel name (e.g. `渤海晶珠`); `null` if absent |
| `departureTime`, `arrivalTime` | `HH:MM` strings |
| `fromPort`, `toPort` | Departure and arrival passenger ports |
| `duration` | Trip length as shown (e.g. `6时30分`); `null` if absent |
| `price` | Lowest fare as a number; `null` if non-numeric |
| `status` | Availability text (e.g. `选择舱位`, `售罄`) |
| `url` | The results URL (sailings share the list page, no per-row deeplink) |

Args:
- `<from>`, `<to>` (positional, required): Chinese city names (e.g. `大连` / `烟台`); the results page returns the port-level sailings between them.
- `--date` (required): `YYYY-MM-DD`.
- `--limit` (1-50, default 20).

Sibling of `bus`: the `ship.ctrip.com/` landing is a client-only SPA that does
not hydrate under the browser bridge, so the command navigates the results route
directly via its `?param=<json>` deep link. Sailings arrive through the
`getShipLineV2` XHR and are read from `.list-item-parent` cards by stable
class-keyed fields rather than positional innerText.

## Hotel Detail Columns (`hotel`)

| Column | Notes |
|--------|-------|
| `hotelId` | Echoes the requested id |
| `name`, `enName` | Localised + English (English may be `null`) |
| `star` | `1`-`5`, `null` for unrated / 客栈 entries |
| `score`, `scoreLabel` | Overall rating (e.g. `4.8` / `"超棒"`); both `null` if unrated |
| `reviewCount` | Total review count as an integer |
| `ratingBreakdown` | The four sub-scores joined by ` / ` (e.g. `卫生 4.8 / 设施 4.8 / 环境 4.8 / 服务 4.8`) |
| `facilities` | Hot facilities joined by ` / ` (e.g. `接机服务 / 无线WIFI免费 / 行李寄存`) |
| `checkInOut` | Check-in / check-out policy lines joined by ` / ` |
| `cityName`, `address` | Geo context |
| `lat`, `lon` | Coordinates from the detail page; `null` if absent |
| `url` | Canonical detail URL |

Args:
- `<id>` (positional, required): numeric Ctrip hotel id (discover via `ctrip hotel-suggest`; e.g. `375539`).

The profile is read from `__NEXT_DATA__.props.pageProps.hotelDetailResponse`
(the same SSR source style as `hotel-search`), surfacing the fields the listing
row does not carry. Room-level nightly prices load via a post-SSR XHR and are
out of scope here, the same way `flight`'s post-load price XHR is; `hotel-search`
already reports a representative nightly price per hotel.

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
