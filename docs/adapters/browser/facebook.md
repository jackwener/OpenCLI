# Facebook

**Mode**: 🔐 Browser · **Domain**: `facebook.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli facebook profile` | Get user/page profile info |
| `opencli facebook notifications` | Get recent notifications with `unread` / `time` / `url` / `notif_id` / `notif_type` |
| `opencli facebook feed` | Get news feed posts |
| `opencli facebook search` | Search people, pages, posts |
| `opencli facebook marketplace-listings` | List your Marketplace seller listings |
| `opencli facebook marketplace-inbox` | List recent Marketplace buyer/seller conversations |
| `opencli facebook marketplace-search` | Search Marketplace listings for sale (buyer side) with location / price / sort / recency filters |

## Usage Examples

```bash
# View a profile
opencli facebook profile zuck

# Get notifications (default 15, max 100)
opencli facebook notifications --limit 10

# News feed
opencli facebook feed --limit 5

# Search
opencli facebook search "OpenAI" --limit 5

# Marketplace seller listings and inbox
opencli facebook marketplace-listings --limit 10
opencli facebook marketplace-inbox --limit 10

# Marketplace buyer search (defaults to your saved location)
opencli facebook marketplace-search "road bike" --limit 10
opencli facebook marketplace-search "bike" --location chicago --min-price 100 --max-price 300 --sort newest --days 7
opencli facebook marketplace-search "schwinn" --exact --sort price-asc -f json

# JSON output
opencli facebook profile zuck -f json
```

## Output

### `notifications`

| Column | Type | Notes |
|--------|------|-------|
| `index` | int | 1-based row number across the returned page |
| `unread` | bool | Derived from the explicit `<div>未读</div>` / `<div>Unread</div>` badge child; falls back to the anchor text prefix |
| `text` | string | Notification body text. Read first from the per-row "Mark as read" button's `aria-label` (with the locale prefix stripped) so it does not include the unread badge or trailing time. Full body, **no silent truncation** |
| `time` | string \| null | Time-ago label from the row's `<abbr>`, e.g. `2天` / `5 hrs`. `null` when the abbr is missing — never the legacy `'-'` sentinel |
| `url` | string | Full notification anchor href, including `notif_id` / `notif_t` query params, so callers can follow up |
| `notif_id` | string \| null | `notif_id` query param parsed from `url`; `null` when absent |
| `notif_type` | string \| null | `notif_t` query param (e.g. `onthisday`, `approve_from_another_device`, `group_recommendation`); `null` when absent |

`--limit` accepts a positive integer in `[1, 100]`. Out-of-range or
non-numeric input raises `ArgumentError` upfront — no silent clamp.

If Facebook redirects to a login/checkpoint path (for example
`/login.php`, `/login/identify/`, or `/checkpoint/`; session expired)
the command raises `AuthRequiredError`. An empty notification list after
a successful auth check raises `EmptyResultError` instead of a silent
`[]`.

### `marketplace-search`

| Column | Type | Notes |
|--------|------|-------|
| `index` | int | 1-based row number |
| `id` | string | Marketplace listing id |
| `title` | string | Listing title |
| `price` | number | Asking price as a plain number; `0` for "Free" |
| `currency` | string \| null | Currency prefix as shown (`$`, `CA$`, `€`); `null` for "Free" |
| `originalPrice` | number \| null | Previous price when the card shows "reduced from …"; otherwise `null` |
| `location` | string \| null | `City, ST` as shown on the card; `null` for shipped-only items |
| `badge` | string \| null | Card badge such as `Just listed`; otherwise `null` |
| `image` | string \| null | Thumbnail URL |
| `url` | string | Canonical `https://www.facebook.com/marketplace/item/<id>/` |

Options: `--location <slug|id>` (the city segment of a Marketplace URL: a
named slug such as `chicago` or `nyc`, which only major cities have, or the
numeric city id such as `108659242498155`; omit to use the account's saved
location), `--limit` (1-100; the command scrolls when more than one batch of
24 is requested), `--min-price` / `--max-price`, `--sort`
(`best` | `newest` | `price-asc` | `price-desc` | `distance`), `--days`
(`1` | `7` | `30`), `--exact`.

Facebook silently drops an unknown city slug and falls back to the saved
location; the command detects that redirect and raises `ArgumentError`
rather than returning listings for the wrong place. Rows are read from each
card's `aria-label` (Facebook's accessibility contract:
`"<title>, <price>[, reduced from <price>], <city>, <state>, listing <id>"`)
with the inner spans as a fallback.

## Prerequisites

- Chrome running and **logged into** facebook.com
- [Browser Bridge extension](/guide/browser-bridge) installed
