# NASA APOD

**Mode**: 🌐 Public · **Domain**: `api.nasa.gov`

NASA's Astronomy Picture of the Day. Hits `api.nasa.gov/planetary/apod` with `DEMO_KEY` by default; set `NASA_API_KEY` to lift the demo rate cap.

## Commands

| Command | Description |
|---------|-------------|
| `opencli nasa-apod today` | Today's APOD (or APOD for a specific date) |
| `opencli nasa-apod range <start>` | Multiple APOD entries between two dates (newest-first) |

## Usage Examples

```bash
# Today's picture
opencli nasa-apod today

# A specific day (YYYY-MM-DD; APOD started 1995-06-16)
opencli nasa-apod today --date 2026-04-08

# A date range (start positional, --end optional, defaults to start)
opencli nasa-apod range 2026-05-01 --end 2026-05-06
```

## Output Columns

| Command | Columns |
|---------|---------|
| `today` | `date, title, mediaType, explanation, url, hdurl, copyright, pageUrl` |
| `range` | `rank, date, title, mediaType, explanation, url, hdurl, copyright, pageUrl` |

## Options

### `today`

| Option | Description |
|--------|-------------|
| `--date` | YYYY-MM-DD; must be ≥ 1995-06-16 (APOD epoch) and ≤ today |

### `range`

| Option | Description |
|--------|-------------|
| `start` (positional) | Start date YYYY-MM-DD (≥ 1995-06-16) |
| `--end` | End date YYYY-MM-DD; defaults to `start` (single day) |

## Notes

- **`pageUrl`** is the human-readable APOD permalink (`https://apod.nasa.gov/apod/apYYMMDD.html`) — derived from `date`, useful for quick copy-paste into a browser.
- **`mediaType`** is usually `image`, sometimes `video` — `url` then points at the video; `hdurl` is empty for videos.
- **Newest-first sort.** `range` reverses NASA's oldest-first ordering so the first row is the most recent date in the range.
- **`DEMO_KEY` rate cap** is ~30 req/hour and ~50 req/day. Set `NASA_API_KEY` (free signup at `api.nasa.gov`) to raise it.
- **Errors.** Bad date format / `start > end` / pre-epoch date → `ArgumentError`; API returning no entries → `EmptyResultError`; rate-limited / transport → `CommandExecutionError`.
