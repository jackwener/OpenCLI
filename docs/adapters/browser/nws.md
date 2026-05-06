# NWS

**Mode**: 🌐 Public · **Domain**: `api.weather.gov`

US National Weather Service public API. Forecast lookup by lat/lon and active alerts (national or per-state).

## Commands

| Command | Description |
|---------|-------------|
| `opencli nws forecast <lat,lon>` | 7-day forecast for a US lat/lon point (~14 day+night periods) |
| `opencli nws alerts` | Active US weather alerts (optionally filtered by state) |

## Usage Examples

```bash
# Forecast for downtown San Francisco
opencli nws forecast "37.7749,-122.4194"

# All active alerts (national)
opencli nws alerts

# Per-state filter
opencli nws alerts --state CA --limit 10
```

## Output Columns

| Command | Columns |
|---------|---------|
| `forecast` | `rank, name, startTime, endTime, isDaytime, temperature, temperatureUnit, windSpeed, windDirection, shortForecast, detailedForecast, precipitationProbability` |
| `alerts` | `rank, id, event, severity, urgency, certainty, headline, areaDesc, sent, effective, expires, senderName, description, url` |

## Options

### `forecast`

| Option | Description |
|--------|-------------|
| `point` (positional) | `lat,lon` decimal degrees (US only — Alaska/Hawaii/territories supported) |

### `alerts`

| Option | Description |
|--------|-------------|
| `--state` | 2-letter US state code (e.g. `CA`, `TX`); default: all |
| `--limit` | Max rows (1–500, default 50) — applied client-side, NWS rejects `limit=` query param |

## Notes

- **Two-fetch forecast chain.** `forecast` first hits `/points/<lat>,<lon>` to discover the gridpoint forecast URL, then fetches the actual periods. NWS only covers US territory — points outside the US (or far at sea) return no `forecast` URL → `EmptyResultError`.
- **`temperatureUnit`** is always `F` for the standard forecast endpoint; metric units would require a different endpoint not exposed here.
- **`precipitationProbability`** comes from `properties.probabilityOfPrecipitation.value` and is `null` (not zero) when NWS doesn't supply a value — never silently coerced to 0.
- **NWS `limit=` query.** The `/alerts/active` endpoint rejects a `limit` query param with HTTP 400 ("Query parameter not recognized"). The adapter omits it from the URL and slices client-side instead.
- **User-Agent.** NWS terms ask for an identifying User-Agent so they can contact you on issues; the adapter sends `opencli-nws/1.0 (https://github.com/jackwener/opencli)`.
- **Errors.** Bad coord / bad state / out-of-range limit → `ArgumentError`; no forecast (off-coverage) / no active alerts → `EmptyResultError`; transport / non-200 → `CommandExecutionError`.
