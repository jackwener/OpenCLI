# NHL

**Mode**: 🌐 Public · **Domain**: `api-web.nhle.com`

NHL standings and schedule from the official `api-web.nhle.com` JSON API. No auth required.

## Commands

| Command | Description |
|---------|-------------|
| `opencli nhl standings` | Current league standings (points, record, GF/GA, streak) |
| `opencli nhl schedule` | Games for today or a specific date (teams, time, score, game type) |

## Usage Examples

```bash
# Today's standings
opencli nhl standings

# Standings on a specific date (YYYY-MM-DD)
opencli nhl standings --date 2026-04-01

# Today's games
opencli nhl schedule

# Schedule for a specific date
opencli nhl schedule --date 2026-05-06
```

## Output Columns

| Command | Columns |
|---------|---------|
| `standings` | `rank, conference, division, team, abbrev, gp, wins, losses, otLosses, points, pointPct, gf, ga, gd, homeRecord, roadRecord, l10Record, streak` |
| `schedule` | `rank, gameId, gameType, startTimeUTC, awayTeam, awayScore, homeTeam, homeScore, venue, gameState, period, url` |

## Options

### `standings`

| Option | Description |
|--------|-------------|
| `--date` | Standings as of a specific date (YYYY-MM-DD); defaults to today |

### `schedule`

| Option | Description |
|--------|-------------|
| `--date` | Schedule for a specific date (YYYY-MM-DD); defaults to today |

## Notes

- **Game type labels**: `1=preseason, 2=regular, 3=playoff, 4=allstar` — surfaced as a string in the `gameType` column instead of the raw integer.
- **`homeRecord` / `roadRecord` / `l10Record`** are formatted as `W-L-OT` strings (e.g. `25-12-4`).
- **`startTimeUTC`** is ISO 8601 UTC; convert client-side for local time.
- **`gameState`** comes straight from the API: `FUT` (future), `LIVE`, `CRIT` (critical, late game), `OFF` (final), `OVER` (final/overtime).
- **No API key.** Public endpoint, no signup. Heavy bursts may rate-limit and surface as `CommandExecutionError`.
- **Errors.** Bad `--date` format → `ArgumentError`; the API returning no data for a given date → `EmptyResultError`; transport / non-200 → `CommandExecutionError`.
