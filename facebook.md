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

## Prerequisites

- Chrome running and **logged into** facebook.com
- [Browser Bridge extension](/guide/browser-bridge) installed
