# OpenF1

**Mode**: 🌐 Public · **Domain**: `openf1.org`

Formula 1 telemetry + session metadata from the public REST API at `api.openf1.org/v1`. No auth, no API key. Covers seasons from 2023 onward (older seasons have partial coverage). Use `sessions` to find a `session_key`, then drill down with `drivers`.

## Commands

| Command | Description |
|---------|-------------|
| `opencli openf1 sessions` | F1 sessions (Race / Qualifying / Practice / Sprint) with session_key for drilldown |
| `opencli openf1 drivers <session-key>` | Drivers entered for a specific session |

## Usage Examples

```bash
# Session listing
opencli openf1 sessions --year 2024 --limit 30
opencli openf1 sessions --year 2024 --session-type Race
opencli openf1 sessions --year 2024 --country-code MON
opencli openf1 sessions --session-type Qualifying --limit 10

# Drivers for a session (use sessions to find session_key first)
opencli openf1 drivers 9472
opencli openf1 drivers 9472 --driver-number 1
opencli openf1 drivers 9472 --driver-number 44
```

## Output Columns

| Command | Columns |
|---------|---------|
| `sessions` | `rank, sessionKey, meetingKey, sessionType, sessionName, circuit, countryCode, countryName, location, dateStart, dateEnd, gmtOffset, year, isCancelled` |
| `drivers` | `rank, driverNumber, broadcastName, fullName, nameAcronym, firstName, lastName, teamName, teamColour, countryCode, sessionKey, meetingKey, headshotUrl` |

## Options

### `sessions`

| Option | Description |
|--------|-------------|
| `--limit` | Max rows (1–200, default 30). Sliced client-side; upstream has no `limit=` param. |
| `--year` | Filter by season year (e.g. `2024`) |
| `--session-type` | `Race` \| `Qualifying` \| `Practice` \| `Sprint` \| `Sprint Shootout` |
| `--country-code` | 3-letter country code (e.g. `BRN`, `MON`, `GBR`). Auto-uppercased. |

### `drivers`

| Option | Description |
|--------|-------------|
| `<session-key>` | Required positional. session_key from `openf1 sessions` (e.g. `9472`). |
| `--driver-number` | Filter to a specific driver number (e.g. `1`, `44`). |

## Notes

- **No server-side `limit=` param.** OpenF1 doesn't accept `?limit=N`; the adapter slices the full filtered response client-side. For `sessions` that's small (<100 even for a full season). `drivers` is always ~20 rows so no slice needed.
- **`sessions → drivers` round-trip.** `sessionKey` from `sessions` is exactly what `drivers <session-key>` expects.
- **`country-code` is auto-uppercased.** `--country-code mon` and `--country-code MON` both work.
- **`driver_number` is per-session, not stable.** Some drivers change numbers across seasons. Always filter with the session you care about.
- **`<session-key>` is required.** `drivers` without it raises `ArgumentError` with a hint to run `sessions` first — no silent "all drivers ever" fallback.
- **Server sorts `sessions` by `date_start` ascending.** Most-recent year-end shows last; combine with `--year` and slicing for filtered tables.
- **Errors.** Missing `<session-key>` / out-of-range `--limit` → `ArgumentError`; empty result → `EmptyResultError`; 429 → `CommandExecutionError`; other non-200 → `CommandExecutionError`.
