# Open-Meteo

**Mode**: 🌐 Public · **Domain**: `api.open-meteo.com`, `geocoding-api.open-meteo.com`

Resolve a city / place name to lat/lon coordinates and fetch a daily weather forecast. Open-Meteo is a free no-API-key weather service backed by ECMWF / DWD / GFS forecast models.

## Commands

| Command | Description |
|---------|-------------|
| `opencli open-meteo geocode <name>` | Resolve a city / place name to lat/lon (no API key) |
| `opencli open-meteo forecast <latitude> <longitude>` | Daily weather forecast for a lat/lon pair (1–16 days) |

## Usage Examples

```bash
# Resolve a city name (returns multiple candidates ranked by population)
opencli open-meteo geocode tokyo
opencli open-meteo geocode "san francisco" --limit 5

# Forecast (lat/lon round-trips from geocode)
opencli open-meteo forecast 35.6895 139.69171              # default 7 days
opencli open-meteo forecast 37.7749 -122.4194 --days 10    # SF, 10 days
opencli open-meteo forecast 51.5074 -0.1278 --days 16      # London, full 16-day window
```

## Output Columns

| Command | Columns |
|---------|---------|
| `geocode` | `rank, id, name, country, admin1, latitude, longitude, elevation, population, timezone, featureCode, url` |
| `forecast` | `date, weatherCode, weather, tempMax, tempMin, apparentMax, apparentMin, sunrise, sunset, precipSum, precipHours, precipProbabilityMax, windMax, windGustMax, uvIndexMax, tempUnit, precipUnit, windUnit` |

The `latitude` / `longitude` columns from `geocode` round-trip into `forecast`.

## Options

### `geocode`

| Option | Description |
|--------|-------------|
| `name` (positional) | Place name (e.g. `Tokyo`, `San Francisco`) |
| `--limit` | Max results (1–100, default: 10) |

### `forecast`

| Option | Description |
|--------|-------------|
| `latitude` (positional) | Latitude in decimal degrees (-90 to 90) |
| `longitude` (positional) | Longitude in decimal degrees (-180 to 180) |
| `--days` | Forecast days (1–16, default: 7) |

## Notes

- **`weather` decodes WMO weather codes** to human labels (`'Clear sky'`, `'Drizzle: light'`, `'Thunderstorm with heavy hail'`). The raw `weatherCode` is also surfaced for programmatic use.
- **Units travel with the row.** `tempUnit` is `'°C'` (Open-Meteo default), `precipUnit` is `'mm'`, `windUnit` is `'km/h'`. They are returned per-row so agents can show units alongside values without a separate lookup.
- **Timezone is auto-detected from the lat/lon pair** (`timezone=auto`). Sunrise / sunset / time-of-day fields come back in the location's local timezone.
- **No silent clamping on `--days`.** The adapter requests exactly `forecast_days=N` from Open-Meteo and emits one row per returned day. If Open-Meteo returns fewer rows (e.g. because the model horizon is exceeded), every row that came back is surfaced — no padding, no truncation.
- **`featureCode`** is the GeoNames feature class (`PPLC` = capital city, `PPL` = populated place, `PPLA` = first-order admin division). Useful for filtering geocode hits.
- **No API key required.** Open-Meteo's free tier allows ~10k requests/day from a single IP; bursts → `CommandExecutionError`.
- **Errors.** Out-of-range lat/lon, bad days, empty geocode query → `ArgumentError`; unknown place → `EmptyResultError`; HTTP 400 (Open-Meteo bad-params) / 429 / transport → `CommandExecutionError`.
