# 腾讯地图 (Tencent Maps)

**Mode**: 🌐 Public · **Domain**: `h5gw.map.qq.com`

Geocoding and coordinate work backed by Tencent Location Services — the engine behind the [coordinate picker](https://lbs.qq.com/getPoint/). No login, no cookie, no browser: the adapter talks to the same public WebService the page itself calls.

## Commands

| Command | Description |
|---------|-------------|
| `opencli tencent-map search <keyword>` | Keyword → candidate places with coordinates |
| `opencli tencent-map address <address>` | Forward geocoding: full address → one coordinate (`--verify` to reverse-check it) |
| `opencli tencent-map locate <lat,lng>` | Reverse geocoding: coordinate → address / admin divisions / nearest POI |
| `opencli tencent-map convert <coords>` | WGS-84 / GCJ-02 / BD-09 conversion — pure local math |

## Usage Examples

```bash
# Keyword search limited to a city (regional endpoint)
opencli tencent-map search "腾讯滨海大厦" --region 深圳市 --limit 5

# Nationwide keyword lookup (input-suggestion endpoint, no --region)
opencli tencent-map search "天安门" --limit 3

# Full address → coordinate, then verify what that point actually is
opencli tencent-map address "广东省深圳市南山区海天二路33号" --verify

# A street-level address with the city supplied separately
opencli tencent-map address "海天二路33号" --region 深圳市

# Coordinate → address (this is the getPoint page's "点图获取坐标" flow)
opencli tencent-map locate "22.522807,113.935338"

# GPS → Tencent (GCJ-02), the conversion the getPoint page does NOT offer
opencli tencent-map convert "22.523055,113.935258"

# Batch, and the other two systems
opencli tencent-map convert "22.523055,113.935258;39.908823,116.39747" --from wgs84 --to bd09
opencli tencent-map convert "22.520025,113.940125" --from tencent --to gps
```

## Typical Flows

**Pick a point from a name** — search, then confirm the winner is really there:

```bash
opencli tencent-map search "深圳湾体育中心" --region 深圳市 --limit 5 -f json
opencli tencent-map address "广东省深圳市南山区滨海大道3001号" --verify
```

**Turn a device coordinate into an address** — convert the datum first, or the address will be off by ~600 m:

```bash
opencli tencent-map convert "22.523055,113.935258"     # GPS → GCJ-02
opencli tencent-map locate "22.520025,113.940125"
```

**Audit an address you were handed** — geocode it, then read what the coordinate actually is:

```bash
opencli tencent-map address "上海市浦东新区世纪大道100号" --verify
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, title, address, lat, lng, category, tel, poi_id, adcode, province, city, district, source` |
| `address` | `query, title, address, lat, lng, province, city, district, street, street_number, adcode, similarity, reliability, level, deviation, verify_address` |
| `locate` | `lat, lng, address, standard_address, recommend_address, nation, province, city, district, street, street_number, adcode, phone_area_code, nearest_poi, poi_count` |
| `convert` | `input, from, to, lat, lng, shift_meters, inside_china` |

## Options

### `search`

| Option | Description |
|--------|-------------|
| `keyword` (positional) | Search text, e.g. `腾讯滨海大厦` |
| `--region` | City name (e.g. `深圳市`). With it the adapter uses `place/v1/search`; without it, the nationwide suggestion endpoint |
| `--limit` | Rows to return (default 10, max 60) |

### `address`

| Option | Description |
|--------|-------------|
| `address` (positional) | Address text. Must carry a city component — see Notes |
| `--region` | City name, folded into the query text when the address does not already contain it |
| `--verify` | Reverse-geocode the resolved coordinate and fill `verify_address` |

### `locate`

| Option | Description |
|--------|-------------|
| `location` (positional) | `lat,lng` — **latitude first**, matching Tencent's own parameter order |

### `convert`

| Option | Description |
|--------|-------------|
| `coords` (positional) | One or more `lat,lng` pairs separated by `;` |
| `--from` | Source system: `wgs84`/`gps`, `gcj02`/`tencent`/`amap`, `bd09`/`baidu` (default `wgs84`) |
| `--to` | Target system, same aliases (default `gcj02`) |

## Notes

- **Tencent coordinates are GCJ-02, not GPS.** The getPoint page only ever shows GCJ-02 ("腾讯坐标"); a coordinate straight from a phone or drone is WGS-84 and lands roughly 600 m away in Shenzhen. `tencent-map convert` is the fix, and it is implemented locally — the forward transform matches Tencent's own `ws/coord/v1/translate?type=1` to six decimal places (the test suite asserts this), so it needs no request and consumes no quota.
- **`convert` is honest about no-ops.** Outside mainland China the GCJ-02 obfuscation does not apply, so WGS-84 → GCJ-02 is an identity there; the row reports `shift_meters: 0` and `inside_china: false` instead of pretending a conversion happened.
- **`address` needs a city.** The geocoder refuses a bare landmark (`天安门` → `348 参数错误`) while `北京市天安门` resolves. That is an `ArgumentError` (exit 2) with a hint pointing at `--region` or `tencent-map search`, not an empty result.
- **Matching is fuzzy even when it succeeds.** `similarity` (0–1), `reliability` (1–10), `level` and `deviation` (metres) come straight from the API — the adapter does not invent a verdict. The trap they expose: a house number that does not exist still answers `status 0` with `similarity 0.99` and `deviation 1000`; the tell is that `title` and `level` collapse from the POI (腾讯滨海大厦, `level 10`) to the street (海天二路, `level 7`). `--verify` adds the decisive check: what the resulting coordinate actually resolves back to.
- **Both `search` shapes are normalised.** `source` records which endpoint answered (`search` vs `suggestion`); the suggestion endpoint has no `tel`, so that column is `null` there.
- **The gateway contract.** Requests go to `h5gw.map.qq.com` with the same literal `key=[你的key]` placeholder the page sends (the gateway substitutes the site's own credential) and a per-service `apptag`. Dropping `apptag` makes every endpoint answer `700 参数错误`. This is the page's own public credential being reused, not a bypass — no login, captcha or rate-limit workaround is involved. Keep request volume modest: the quota belongs to the site.
- **`place/v1/search` requires a real `boundary`.** `region(全国,0)` is syntactically valid but always returns zero rows — which is why a nationwide query routes to the suggestion endpoint instead.
- **Errors.** Bad coordinates / unknown CRS / identical `--from`/`--to` / an unparseable address → `ArgumentError` (exit 2); a valid query with no match → `EmptyResultError` (exit 66); transport failures and non-zero gateway statuses → `CommandExecutionError` (exit 1).
