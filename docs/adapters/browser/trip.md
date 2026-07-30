# Trip.com

**Mode**: 🌐 Public (`search`, `package`) · 🖥️ Browser + Cookie (`flight`, `flight-round`, `hotel-search`, `hotel`, `attraction`, `train`, `car`, `transfer`, `tour`, `deals`)
**Domain**: `trip.com`

Trip.com is the international (English) sibling of the `ctrip` adapter, run by
the same company. These commands search worldwide flights and hotels on
`trip.com` in English / USD, browser-mode + cookie like their `ctrip` peers.

## Commands

| Command | Mode | Description |
|---------|------|-------------|
| `opencli trip search` | Public | Suggest destinations (cities + airports) for a keyword, resolving the ids other commands take |
| `opencli trip flight` | Browser (cookie) | One-way flight search by IATA route + departure date |
| `opencli trip flight-round` | Browser (cookie) | Round-trip flight search by IATA route + depart/return dates |
| `opencli trip hotel-search` | Browser (cookie) | List hotels for a city id + check-in/out date range |
| `opencli trip hotel` | Browser (cookie) | Single-hotel detail by id: rating breakdown, amenities, check-in/out policy |
| `opencli trip attraction` | Browser (cookie) | Attractions and experiences (tickets + tours) search by destination keyword |
| `opencli trip train` | Browser (cookie) | Train route timetable (departure/arrival times, duration, changes) |
| `opencli trip car` | Browser (cookie) | Car-rental listing for a city (category, model, seats, daily price) |
| `opencli trip transfer` | Browser (cookie) | Airport-transfer listing for a city + airport (type, seats, from-price) |
| `opencli trip tour` | Browser (cookie) | Tour-package search by destination keyword (private or group tours) |
| `opencli trip package` | Public | Flight+hotel package search by route + dates (package flight options at the bundle rate) |
| `opencli trip deals` | Browser (cookie) | List Trip.com live promotions (Top Deals hub): campaign title, offer, discount, link |

## Usage Examples

```bash
# Destination suggest (resolves city ids + airport codes for the commands below)
opencli trip search Tokyo --limit 10

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

# Airport-transfer listing (airport city + IATA code)
opencli trip transfer Bangkok DMK --limit 10

# Tour-package search (destination keyword; private tours by default)
opencli trip tour Kyoto --limit 20
opencli trip tour Bangkok --type group --limit 10

# Flight+hotel package search (city keywords + dates)
opencli trip package Seoul Tokyo --depart 2026-08-05 --return 2026-08-08 --limit 10

# Live promotions (Top Deals hub)
opencli trip deals --limit 10
```

## Search Columns (`search`)

| Column | Notes |
|--------|-------|
| `rank` | 1-based position in the suggest list |
| `name` | Destination name (city, airport, province, or place) |
| `type` | `airport` when the row carries an airport code, otherwise `city` |
| `cityId` | Numeric Trip.com city id (feeds `hotel-search` / `car` / `tour`); `null` for non-city rows |
| `airportCode` | 3-letter IATA code (feeds `flight` / `transfer`); `null` for non-airport rows |
| `province`, `country` | Geo context |

Args:
- `<query>` (positional, required): a destination keyword (e.g. `Tokyo` / `Bali` / `London`).
- `--limit` (1-50, default 20).

`search` is a public, unsigned POST to Trip.com's POI-suggest endpoint (no browser
session needed), the same lookup the flight / hotel search boxes use. Each matched
city keeps its own row and its nearby airports follow, so one call surfaces both
the `cityId` and the `airportCode` the id-based commands take. Rows without an id
keep `cityId` / `airportCode` as `null` rather than a sentinel.

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
and experiences into this one result set. Travel eSIM / SIM data plans are also
sold as things-to-do products, so `trip attraction eSIM` (or a destination
keyword) surfaces them with the same columns.

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

## Transfer Columns (`transfer`)

| Column | Notes |
|--------|-------|
| `rank` | 1-based position in the rendered listing |
| `type` | Vehicle type (e.g. `Standard Car`, `Minibus`, `Business 7 seater`) |
| `passengers` | Maximum passengers as an integer; `null` if absent |
| `luggage` | Maximum luggage pieces as an integer; `null` if absent |
| `price`, `currency` | Representative from-price and `USD`; `price` is `null` when non-numeric |
| `url` | The listing URL (vehicles share the airport page) |

Args:
- `<city>` (positional, required): the airport city (e.g. `Bangkok` / `Beijing` / `Da Nang`), slugified into the URL.
- `<airport>` (positional, required): the 3-letter airport IATA code (e.g. `DMK` / `PKX` / `DAD`).
- `--limit` (1-50, default 20).

Trip.com files airport transfers under an SEO path keyed on the city slug plus
the airport IATA code (`airport-transfers/<city>/airport-<iata>/`). A city that
does not match the airport bounces to the transfer landing, so the command checks
the landed path and raises `CommandExecutionError` rather than returning the
generic landing list. Rows come from `.vehicle-card` cards, read by stable class
fields (`.vehicle-card__title-text` / `.vehicle-card__capacity-text` /
`.vehicle-card__luggage-text` / `.vehicle-card__price-row`); the `$N off` promo
sits in a separate discount tag and is excluded, and the dated pickup quote sits
behind the booking step.

## Tour Columns (`tour`)

| Column | Notes |
|--------|-------|
| `rank` | 1-based position in the rendered result set |
| `name` | Tour title (e.g. `4D3N · Private Tours · Japan + Osaka + Kyoto ...`) |
| `type` | Product line as shown (`Private Tours` / `Group Tours`) |
| `rating` | Guest rating out of 5; `null` when the tour has no reviews yet |
| `reviews` | Review count as an integer; `null` when absent |
| `price`, `currency` | Starting per-person estimate and `USD`; `price` is `null` when non-numeric |
| `url` | Per-tour detail URL (`package-tours/detail/<id>`) |

Args:
- `<query>` (positional, required): a destination or tour keyword (e.g. `Tokyo` / `Kyoto` / `Bali`).
- `--type` (`private` or `group`, default `private`): the tour product line.
- `--limit` (1-50, default 20).

Trip.com serves tour results (`package-tours/list?kwd=<keyword>`) through a signed
POST that only fires on a search submit, so rather than replaying the signature
the command opens the results page and re-submits the keyword in the page's own
search box, letting the page issue its own signed request while a fetch hook
captures the `products` response. Rows read the product `name`, `type`, rating,
review count, starting price, and per-tour detail URL from that JSON; per-departure
pricing and availability sit behind the booking step.

## Package Columns (`package`)

| Column | Notes |
|--------|-------|
| `rank` | 1-based position in the returned package groups |
| `airline` | Operating airline of the outbound flight |
| `flightNo` | Outbound flight number |
| `from`, `to` | Outbound departure / arrival IATA airport codes (arrival read off the last leg for a connection) |
| `departure`, `arrival` | Outbound `YYYY-MM-DD HH:MM:SS` local times |
| `stops` | Number of stops on the outbound (`0` for a nonstop) |
| `price`, `currency` | Per-person package starting fare and `USD`; `price` is `null` when absent |

Args:
- `<from>`, `<to>` (positional, required): origin and destination city keywords (e.g. `Seoul` / `Tokyo`), resolved through the same POI search `search` uses.
- `--depart`, `--return` (required): `YYYY-MM-DD`, with `depart` before `return`.
- `--adults` (1-9, default 2).
- `--limit` (1-50, default 20).

Trip.com prices flight+hotel packages through the flight-selection step of the
booking flow: a public, unsigned POST keyed on the metro city codes plus the
destination hotel city id returns the outbound flight options priced at the bundle
rate. So the command resolves both keywords to their city code + id, posts the
package search (no browser session needed), and lists those flights. The specific
hotel is chosen in a later booking step, so per-row hotel detail and the return leg
(which rides on the hotel checkout date) are out of scope here.

## Deals Columns (`deals`)

| Column | Notes |
|--------|-------|
| `rank` | 1-based position in the Top Deals hub |
| `title` | Campaign title (e.g. `Go Japan`, `Explore Taiwan`) |
| `offer` | Offer line as shown (e.g. `Hotel up to 50% off`); `null` if the tile carries none |
| `discount` | Discount parsed from the title / offer (e.g. `50%`, `$15 off`); `null` when the campaign states none |
| `url` | Canonical campaign page URL (per-session promo tracking stripped) |

Args:
- `--limit` (1-50, default 20).

Trip.com curates its running campaigns on a "Today's Top Deals" hub
(`/sale/deals/`), each a promo tile linking to a dedicated campaign page. Rows come
from the rendered `.top-deals_link-item` tiles (title in `.top-deals_item-tit`,
offer in `.top-deals_item-desc`), deduped by the canonical campaign URL; tiles
without a title or offer are dropped. The per-campaign terms and the bookable
inventory behind each campaign are out of scope here.

## Prerequisites

- Chrome running with the [Browser Bridge extension](/guide/browser-bridge) installed.
- A `trip.com` session in that Chrome profile. Flight search works without login,
  but a verification gate (suspected bot) raises `AuthRequiredError`; complete it
  in your live session and retry.

## Notes

- Trip.com is English/USD-facing. For the mainland Chinese site (Chinese UI, CNY,
  domestic rail), use the `ctrip` adapter instead.
- This adapter covers Trip.com's travel verticals end to end: flights, hotels,
  attractions, train timetables, car rentals, airport transfers, tour packages,
  flight+hotel packages, and the live-promotions hub.
