# wttr.in

**Mode**: 🌐 Public · **Domain**: `wttr.in`

Global weather lookup from `wttr.in` — no auth, no signup. Covers any city / lat,lon / airport ICAO code that wttr.in can geocode (worldwide, unlike NWS which is US-only).

## Commands

| Command | Description |
|---------|-------------|
| `opencli wttr current <location>` | Current weather conditions (single row) |
| `opencli wttr forecast <location>` | Multi-day forecast (1–3 days, free-tier max) |

## Usage Examples

```bash
# Current conditions by city name
opencli wttr current Tokyo
opencli wttr current "New York"

# By lat,lon
opencli wttr current "37.7749,-122.4194"

# By airport ICAO
opencli wttr current KSFO

# 3-day forecast
opencli wttr forecast Paris
opencli wttr forecast Paris --days 2
```

## Output Columns

| Command | Columns |
|---------|---------|
| `current` | `location, region, country, latitude, longitude, observedAt, tempC, tempF, feelsLikeC, feelsLikeF, description, humidity, cloudCover, pressure, precipMm, visibilityKm, uvIndex, windKmph, windDirection, windDirectionDegree` |
| `forecast` | `rank, date, minTempC, maxTempC, avgTempC, minTempF, maxTempF, avgTempF, sunHour, totalSnowCm, uvIndex, description, sunrise, sunset` |

## Options

### `current`

| Option | Description |
|--------|-------------|
| `location` (positional) | City name, `lat,lon`, airport ICAO code, or `@domain` (uses GeoIP for the domain's hosting region) |

### `forecast`

| Option | Description |
|--------|-------------|
| `location` (positional) | Same as `current` |
| `--days` | Forecast days (1–3, default 3 — wttr.in free tier caps at 3 days) |

## Notes

- **`?format=j1` JSON.** wttr.in's default response is ANSI-colored ASCII art for terminal use; the adapter requests `?format=j1` to get the JSON variant.
- **Multi-arrays for descriptive text.** `weatherDesc`, `areaName`, `country`, `region` are all `[{value: "..."}]` arrays in wttr's schema (single-element 99% of the time but the schema is a list). The adapter unwraps them via `pickWeatherDesc`.
- **Noon-slot description for forecast.** wttr.in returns 8 hourly slots per day at 3-hour steps; index 4 is noon, which the adapter uses as the day's "main" weather description (matches how wttr's terminal output picks a representative slot).
- **Geocoding is fuzzy.** wttr.in resolves "Tokyo" to whatever weatherstation is nearest the search point; results may be `Shikinejima` (an island) instead of central Tokyo for some queries. `nearest_area` columns reveal what point wttr actually returned data for.
- **Numeric coercion.** wttr.in returns all numbers as strings (e.g. `"18"`); the adapter `Number(...)` coerces them so downstream tools can compare numerically. `null` is preserved when a slot is missing.
- **Errors.** Empty location / `--days` out of range → `ArgumentError`; 404 / non-JSON body for unknown locations → `EmptyResultError`; transport / non-200 → `CommandExecutionError`.
