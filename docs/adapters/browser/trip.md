# Trip.com

**Mode**: 🖥️ Browser + Cookie (`flight`, `hotel-search`, `hotel`)
**Domain**: `trip.com`

Trip.com is the international (English) sibling of the `ctrip` adapter, run by
the same company. These commands search worldwide flights and hotels on
`trip.com` in English / USD, browser-mode + cookie like their `ctrip` peers.

## Commands

| Command | Mode | Description |
|---------|------|-------------|
| `opencli trip flight` | Browser (cookie) | One-way flight search by IATA route + departure date |
| `opencli trip hotel-search` | Browser (cookie) | List hotels for a city id + check-in/out date range |
| `opencli trip hotel` | Browser (cookie) | Single-hotel detail by id: rating breakdown, amenities, check-in/out policy |

## Usage Examples

```bash
# One-way flight search (English, USD)
opencli trip flight LON NYC --date 2026-08-15 --limit 20
opencli trip flight LHR JFK --date 2026-08-15 -f json

# Hotel listing (numeric city id, e.g. 338 for London)
opencli trip hotel-search 338 --checkin 2026-08-15 --checkout 2026-08-16 --limit 10

# Single-hotel detail (hotel id from the hotels list)
opencli trip hotel 715233
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

## Hotel Listing Columns (`hotel-search`)

| Column | Notes |
|--------|-------|
| `rank` | 1-based position in the rendered list |
| `name` | Hotel name |
| `score`, `reviewLabel` | Guest score (out of 10) and its label (e.g. `Very good`); `null` if unrated |
| `reviews` | Review count as an integer; `null` if absent |
| `location` | Location / landmark descriptions joined by `, ` |
| `room` | Lead room name shown on the card; `null` if absent |
| `price`, `currency` | Nightly price and `USD`; `price` is `null` when non-numeric |
| `url` | The search results URL (cards share the list page) |

Args:
- `<city>` (positional, required): numeric Trip.com city id (discover via the hotels search box; e.g. `338` for London).
- `--checkin`, `--checkout` (required): `YYYY-MM-DD`, validated as real calendar dates with `checkin < checkout`.
- `--limit` (1-50, default 20).

Rows come from `.hotel-card` cards, read by stable class-keyed fields
(`.hotelName` / `.score` / `.comment-num` / `.position-desc` / `.price-highlight`).
Cards without a hotel name are dropped rather than surfaced with blanks.

## Hotel Detail Columns (`hotel`)

| Column | Notes |
|--------|-------|
| `hotelId` | Echoes the requested id |
| `name`, `enName` | Localised + English name (English may be `null`) |
| `star` | Star rating (`1`-`5`); `null` for unrated entries |
| `score`, `scoreLabel` | Guest score out of 10 and its label (e.g. `8.3` / `Very good`); both `null` if unrated |
| `reviewCount` | Total review count as an integer |
| `ratingBreakdown` | The sub-scores joined by ` / ` (e.g. `Cleanliness 8.7 / Location 8.5`) |
| `facilities` | Most-popular amenities joined by ` / ` (e.g. `Luggage storage / Restaurant`) |
| `checkInOut` | Check-in / check-out policy lines joined by ` / ` |
| `cityName`, `address` | Geo context |
| `lat`, `lon` | Coordinates from the detail page; `null` if absent |
| `url` | The detail URL |

Args:
- `<id>` (positional, required): numeric Trip.com hotel id (discover via the hotels list; e.g. `715233`).

The profile is read from `__NEXT_DATA__.props.pageProps.hotelDetailResponse` (the
same SSR shape the mainland `ctrip hotel` detail uses), surfacing the fields the
listing row does not carry. Room-level nightly prices load via a post-SSR XHR and
are out of scope here.

## Prerequisites

- Chrome running with the [Browser Bridge extension](/guide/browser-bridge) installed.
- A `trip.com` session in that Chrome profile. Flight search works without login,
  but a verification gate (suspected bot) raises `AuthRequiredError`; complete it
  in your live session and retry.

## Notes

- Trip.com is English/USD-facing. For the mainland Chinese site (Chinese UI, CNY,
  domestic rail), use the `ctrip` adapter instead.
- Flights and hotels ship today. Trip.com's remaining verticals (trains, cars,
  attractions, tours) are tracked as follow-ups in the adapter request issue.
