# Trip.com

**Mode**: 🖥️ Browser + Cookie (`flight`)
**Domain**: `trip.com`

Trip.com is the international (English) sibling of the `ctrip` adapter, run by
the same company. `trip flight` searches worldwide one-way flights on
`trip.com`, browser-mode + cookie like `ctrip flight`.

## Commands

| Command | Mode | Description |
|---------|------|-------------|
| `opencli trip flight` | Browser (cookie) | One-way flight search by IATA route + departure date |

## Usage Examples

```bash
# One-way flight search (English, USD)
opencli trip flight LON NYC --date 2026-08-15 --limit 20
opencli trip flight LHR JFK --date 2026-08-15 -f json
```

## Flight Columns (`flight`)

| Column | Notes |
|--------|-------|
| `rank` | 1-based position after filtering incomplete rows |
| `airline` | Operating airline name |
| `departureTime`, `arrivalTime` | Local `H:MM AM/PM` strings as rendered |
| `departureAirport`, `arrivalAirport` | 3-letter IATA airport codes |
| `duration` | Trip length as shown (e.g. `7h 50m`); `null` if absent |
| `stops` | Stop summary (e.g. `Nonstop`, `1 stop`); `null` if absent |
| `price` | Lowest fare shown as a number; `null` if non-numeric |
| `currency` | `USD` (the search pins `curr=USD`) |
| `url` | The search URL (Trip.com flight cards share a booking handoff, no per-row deeplink) |

Args:
- `<from>`, `<to>` (positional, required): 3-letter IATA codes (`LON`/`NYC` metro codes work alongside single-airport codes like `LHR`/`JFK`).
- `--date` (required): `YYYY-MM-DD`.
- `--limit` (1-50, default 20).

Rows come from `.result-item` cards, read by stable `data-testid` anchors
(`flights-name`, `stopInfoText`, `flight_price_*`) plus the `HH:MM` / `AM-PM` /
IATA leaf pattern, rather than positional innerText. Cards missing the airline,
both airports, or both times are dropped rather than emitted with sentinel values.

## Prerequisites

- Chrome running with the [Browser Bridge extension](/guide/browser-bridge) installed.
- A `trip.com` session in that Chrome profile. Flight search works without login,
  but a verification gate (suspected bot) raises `AuthRequiredError`; complete it
  in your live session and retry.

## Notes

- Trip.com is English/USD-facing. For the mainland Chinese site (Chinese UI, CNY,
  domestic rail), use the `ctrip` adapter instead.
- Only one-way `flight` ships today. Trip.com's other verticals (hotels, trains,
  cars, attractions) are tracked as follow-ups in the adapter request issue.
