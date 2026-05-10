# Ctrip (携程)

**Mode**: 🌐 Public · **Domain**: `ctrip.com`

Public destination + hotel-context suggestion lookup against the
`m.ctrip.com/restapi/soa2/21881/json/gaHotelSearchEngine` endpoint. No browser
or login required.

## Commands

| Command | Description |
|---------|-------------|
| `opencli ctrip search` | Suggest cities, scenic spots, railway stations and landmarks |
| `opencli ctrip hotel-suggest` | Suggest cities, business areas and individual hotels |

## Usage Examples

```bash
# Destination suggest
opencli ctrip search 苏州 --limit 10

# Hotel-context suggest (cities / business areas / hotels)
opencli ctrip hotel-suggest 陆家嘴 --limit 5

# JSON output
opencli ctrip search 上海 -f json
```

## Columns

Both commands share a uniform column shape:

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

## Notes

- Endpoint discriminator: `searchType=D` (search) vs `searchType=H`
  (hotel-suggest). Hotel and BusinessArea rows only appear in the `H` flavour.
- Mainland China rows ship `gdLat`/`gdLon` (gaode). International rows ship
  `gLat`/`gLon` (wgs84). The adapter picks the first non-zero pair.
- In-band `Result: false` envelopes are surfaced as `COMMAND_EXEC` typed
  errors; HTTP non-2xx becomes `FETCH_ERROR`.
