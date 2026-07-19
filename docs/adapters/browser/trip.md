# Trip.com

**Mode**: 🖥️ Browser + Cookie (`flight`, `flight-round`, `hotel-search`, `hotel`, `attraction`, `train`, `car`)
**Domain**: `trip.com`

Trip.com is the international (English) sibling of the `ctrip` adapter, run by
the same company. These commands search worldwide flights and hotels on
`trip.com` in English / USD, browser-mode + cookie like their `ctrip` peers.

## Commands

| Command | Mode | Description |
|---------|------|-------------|
| `opencli trip flight` | Browser (cookie) | One-way flight search by IATA route + departure date |
| `opencli trip flight-round` | Browser (cookie) | Round-trip flight search by IATA route + depart/return dates |
| `opencli trip hotel-search` | Browser (cookie) | List hotels for a city id + check-in/out date range |
| `opencli trip hotel` | Browser (cookie) | Single-hotel detail by id: rating breakdown, amenities, check-in/out policy |
| `opencli trip attraction` | Browser (cookie) | Attractions and experiences (tickets + tours) search by destination keyword |
| `opencli trip train` | Browser (cookie) | Train route timetable (departure/arrival times, duration, changes) |
| `opencli trip car` | Browser (cookie) | Car-rental listing for a city (category, model, seats, daily price) |

## Usage Examples

```bash
# One-way flight search (English, USD)
opencli trip flight LON NYC --date 2026-08-15 --limit 20
opencli trip flight LHR JFK --date 2026-08-15 -f json

# Round-trip flight search
opencli trip flight-round LON NYC --depart 2026-08-15 --return 2026-08-22 --limit 20

# Hotel listing (numeric city id, e.g. 338 for London)
opencli trip hotel-search 338 --checkin 2026-08-15 --checkout 2026-08-16 --limit 10

# Single-hotel detail (hotel id from the hotels list)
opencli trip hotel 715233

# Attractions and experiences search (destination keyword)
opencli trip attraction Tokyo --limit 20

# Train route timetable (country slug + cities)
opencli trip train London Manchester --country uk --limit 20

# Car-rental listing (numeric carhire city id, e.g. 313 for San Francisco)
opencli trip car 313 --limit 10
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

## Round-Trip Flight Columns (`flight-round`)

`flight-round` returns the outbound leg of a round-trip search (priced for the
round trip) with the same column shape as `flight` (`rank`, `airline`,
`departureTime`, `departureAirport`, `arrivalTime`, `arrivalAirport`, `duration`,
`stops`, `price`, `currency`, `url`) and reuses the same `.result-item` extractor.

Args:
- `<from>`, `<to>` (positional, required): 3-letter IATA codes.
- `--depart`, `--return` (required): `YYYY-MM-DD`, with `depart` before `return`.
- `--limit` (1-50, default 20).

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

## Attraction Columns (`attraction`)

| Column | Notes |
|--------|-------|
| `rank` | 1-based position in the rendered list |
| `name` | Product name (ticket, tour, or experience title) |
| `rating` | Guest rating out of 5; `null` if unrated |
| `reviews` | Review count (`4.9k` expanded to `4900`); `null` if absent |
| `booked` | Booking count (`109.5k` expanded to `109500`); `null` if absent |
| `price`, `currency` | Current fare (the promo `$N off` tag is excluded) and `USD`; `price` is `null` if absent |
| `url` | Per-product detail URL (`things-to-do/detail/<id>`) |

Args:
- `<query>` (positional, required): a destination or attraction keyword (e.g. `Tokyo` / `Paris` / `Louvre`).
- `--limit` (1-50, default 20).

The products load client-side into hashed CSS-module cards, so rows anchor on
each card's stable `things-to-do/detail/<id>` link (name is its text, `url` its
href) and read rating / reviews / booked / price from the card text by
data-format pattern. Trip.com's "Attractions & Tours" combines tickets, tours,
and experiences into this one result set.

## Train Columns (`train`)

| Column | Notes |
|--------|-------|
| `rank` | 1-based position in the timetable |
| `departureTime`, `arrivalTime` | `HH:MM` strings |
| `fromStation`, `toStation` | Departure and arrival station names |
| `duration` | Journey length as shown (e.g. `3h 38m`); `null` if absent |
| `changes` | Number of changes as an integer (`0` for direct); `null` if not stated |
| `url` | The route timetable URL (journeys share the route page) |

Args:
- `<from>`, `<to>` (positional, required): city names (e.g. `London` / `Manchester`), slugified into the route URL.
- `--country` (required): the route country slug Trip.com files the route under (e.g. `uk` / `france` / `italy` / `spain` / `germany` / `china`).
- `--limit` (1-50, default 20).

Trip.com organises train routes as per-country SEO timetable pages
(`trains/<country>/route/<from>-to-<to>/`), so `--country` is required. The page
lists journeys by departure / arrival times, stations, duration, and changes;
per-journey fares sit behind the booking step and are out of scope here.

## Car Columns (`car`)

| Column | Notes |
|--------|-------|
| `rank` | 1-based position in the rendered listing |
| `category` | Vehicle class (e.g. `Mid-sized car`, `Compact SUV`) |
| `vehicle` | Example model shown for the class (e.g. `Toyota Camry or Similar`) |
| `seats` | Passenger capacity as an integer; `null` if absent |
| `price`, `currency` | Representative daily price and `USD`; `price` is `null` when non-numeric |
| `url` | The listing URL (vehicles share the city page) |

Args:
- `<city>` (positional, required): numeric Trip.com carhire city id (discover via the carhire search box; e.g. `313` for San Francisco).
- `--limit` (1-50, default 20).

Trip.com files car-rental listings under an SEO path whose text slugs are
cosmetic, so only the numeric carhire city id routes the page. Rows come from
`.card-item` cards, read by stable class fields (`.card-item-title` /
`.card-item-vehicle-info` / `.car-daily-price`); the daily price is the site's
near-term representative rate, while a dated pickup / drop-off quote sits behind
the booking step and is out of scope here. Cards without a price are dropped
rather than surfaced with blanks.

## Prerequisites

- Chrome running with the [Browser Bridge extension](/guide/browser-bridge) installed.
- A `trip.com` session in that Chrome profile. Flight search works without login,
  but a verification gate (suspected bot) raises `AuthRequiredError`; complete it
  in your live session and retry.

## Notes

- Trip.com is English/USD-facing. For the mainland Chinese site (Chinese UI, CNY,
  domestic rail), use the `ctrip` adapter instead.
- Flights, hotels, attractions, train timetables, and car rentals ship today.
  Trip.com's remaining vertical (airport transfers) is tracked as a follow-up in the adapter request issue.
