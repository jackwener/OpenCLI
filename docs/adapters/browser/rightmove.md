# Rightmove

**Mode**: 🌐 Public · **Domain**: `www.rightmove.co.uk`

## Commands

| Command | Description |
|---------|-------------|
| `opencli rightmove search [<location>]` | Search property listings by postcode, outcode, region, bounding box, or drawn polygon |

## Usage Examples

```bash
# Search around a full postcode
opencli rightmove search "SW1A 1AA" --radius 1 --limit 10

# Search an outcode, sorted by newest
opencli rightmove search W12 --sort newest --limit 20 -f json

# Search a region with price and bedroom filters
opencli rightmove search London \
  --min-price 500000 --max-price 1000000 \
  --min-beds 2 --sort lowest

# Search a map bounding box: west,east,north,south
opencli rightmove search --bbox=-0.2664,-0.1926,51.5296,51.4920 --limit 10

# Search a drawn polygon. Value may be an encoded polyline, a JSON
# [[lat,lng], ...] array, or "lat,lng;lat,lng;lat,lng".
opencli rightmove search --polygon '[[51.51293,-0.24167],[51.51015,-0.24467],[51.50737,-0.24399]]'
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, id, address, price, bedrooms, bathrooms, type, agent, added, latitude, longitude, url` |

`id` is the Rightmove property id and `url` points at the property details
page on `rightmove.co.uk`.

## Args

### `search`

| Arg | Type | Default | Notes |
|-----|------|---------|-------|
| `location` *(positional)* | string | *(none)* | Location text, outcode, or postcode, e.g. `London`, `W12`, `"SW1A 1AA"` |
| `--radius` | float | `0` | Radius in miles around a resolved location, up to `40` |
| `--channel` | string | `buy` | `buy` or `rent` |
| `--sort` | string | `highest` | `highest`, `lowest`, `newest`, or `oldest` |
| `--min-price` | int | *(none)* | Minimum price |
| `--max-price` | int | *(none)* | Maximum price |
| `--min-beds` | int | *(none)* | Minimum bedrooms |
| `--max-beds` | int | *(none)* | Maximum bedrooms |
| `--index` | int | `0` | Pagination offset. Rightmove pages are offset-based (`0`, `24`, `48`, ...) |
| `--limit` | int | `24` | Max rows to return (`1`–`100`) |
| `--include-sstc` | bool | `true` | Include sold subject to contract listings |
| `--bbox` | string | *(none)* | Advanced area mode: `west,east,north,south` |
| `--polygon` | string | *(none)* | Advanced area mode: encoded polyline, JSON points, or semicolon-separated points |

## Notes

- Normal location searches first resolve the user input through Rightmove's
  LOS typeahead endpoint, then query the listing JSON endpoint.
- Full postcodes resolve to `POSTCODE^<id>`, so postcode + radius searches do
  not need external geocoding.
- Drawn-map searches use Rightmove's `USERDEFINEDAREA^{"polylines":"..."}`
  form. The `polylines` value is the standard Google encoded polyline format
  with `1e5` precision.
- Bounding-box searches use `LAT_LONG_BOX^west,east,north,south`.
- The adapter only reads public listing data. It does not require Chrome,
  cookies, or a Rightmove login.

## Limitations

- Rightmove's listing API is public to fetch but intended for Rightmove's own
  web application. Avoid high-volume scraping and prefer small, targeted
  queries.
- Property detail pages use a different HTML-heavy surface; this command only
  returns listing-card fields from search results.
