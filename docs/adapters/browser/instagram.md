# Instagram

**Mode**: 🔐 Browser · **Domain**: `instagram.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli instagram detail` | Get single-post details with direct media URLs |
| `opencli instagram profile` | Get user profile info |
| `opencli instagram search` | Search users |
| `opencli instagram user` | Get recent posts from a user |
| `opencli instagram explore` | Discover trending posts |
| `opencli instagram followers` | List user's followers |
| `opencli instagram following` | List user's following |
| `opencli instagram saved` | Get your saved posts (or one collection) |
| `opencli instagram collection-create` | Create a new saved-posts collection |
| `opencli instagram collection-delete` | Delete a saved-posts collection by name or id |

## Usage Examples

```bash
# View a user's profile
opencli instagram profile nasa

# Search users
opencli instagram search nasa --limit 5

# View a user's recent posts
opencli instagram user nasa --limit 10
# Inspect one post deeply, including direct media URLs
opencli instagram detail https://www.instagram.com/reel/DZZfMsvuxgD/
# Fetch one full local day (strict format)
opencli instagram user devtalksbusiness --date 2026-07-11 --limit 200
# Fetch an exact timestamp window (strict ISO 8601 with timezone)
opencli instagram user devtalksbusiness --from 2026-07-11T18:30:00+05:30 --to 2026-07-12T18:30:00+05:30 --limit 200
# Filter captions and build ready-to-run phase-1 list
opencli instagram user devtalksbusiness --limit 100 --caption-filter "making you financially independent"
# Case-sensitive regex filter with reject rule
opencli instagram user devtalksbusiness --limit 100 --caption-filter-mode regex --caption-filter "financially\\s+independent" --caption-reject "teaser" --caption-case-sensitive

# Discover trending posts
opencli instagram explore --limit 20

# List followers/following
opencli instagram followers nasa --limit 20
opencli instagram following nasa --limit 20

# Get your saved posts (default "All posts" feed)
opencli instagram saved --limit 10

# Get posts from a specific collection (case-insensitive name match)
opencli instagram saved --collection inspiration --limit 10

# Create a new saved-posts collection
opencli instagram collection-create "design refs"

# Delete a collection by name (or by numeric id, e.g. 17853899493659567)
opencli instagram collection-delete "design refs"

# JSON output
opencli instagram profile nasa -f json
```

### Notes on `instagram user`

- `opencli instagram user` now pages through the user feed using `max_id`/`more_available` and can return up to your requested `--limit`.
- It now includes reusable identifiers in output: `kind` (`p` or `reel`), `shortcode`, `media_id`, `posted_at` (ISO 8601), and a canonical `url` (`/p/<shortcode>/` or `/reel/<shortcode>/`).
- Time filtering is strict and standardized so every caller uses the same format:
  - `--date YYYY-MM-DD` fetches one full local calendar day.
  - `--from <timestamp>` and `--to <timestamp>` fetch an exact time window.
  - Timestamp format should be ISO 8601 with timezone, for example `2026-07-11T18:30:00+05:30`.
  - Unix seconds are also accepted for `--from` / `--to`.
  - Do not pass loose natural-language strings like `11 July 6.30pm`; they are rejected on purpose.
  - `--to` requires `--from`.
  - `--date` cannot be combined with `--from` / `--to`.
- `instagram user` now accepts caption filtering for phase-1 extraction:
  - `--caption-filter-mode contains|regex` (default `contains`)
  - `--caption-filter <pattern>` for include matching
  - `--caption-reject <pattern>` for explicit exclusion
  - `--caption-case-sensitive` for exact-case matching (default false for both include/exclude)
- Matching/filtering happens on the parsed JSON caption field before limit slicing, and date/time filtering uses Instagram's raw `taken_at` timestamp.
- `--limit` is bounded (currently `1-1000`) and large backfills may still be constrained by Instagram anti-abuse/rate-limit behavior (for example a temporary `wait a few minutes` response).

### Notes on `instagram detail`

- `opencli instagram detail <url>` reads one post / reel / tv link and returns a single normalized row.
- It includes both the canonical Instagram post `url` and direct CDN-backed `media_urls`.
- `media_urls` are the solid, directly exposed media URLs from Instagram's web metadata payload.
- For carousels, `media_urls` is newline-separated and `media_count` reflects the number of child media items.
- This command does not claim transcript or subtitle support.

### Notes on collections

- `instagram saved` without `--collection` returns the unsegmented "All posts" bucket (same as the original behaviour).
- With `--collection <name>` it resolves the name to an id via `/api/v1/collections/list/`, then fetches `/api/v1/feed/collection/{id}/posts/`. Match is case-insensitive after trimming. An unknown name throws an error that lists the available names.
- `instagram collection-create <name>` calls `POST /api/v1/collections/create/` with a multipart `name` field. Instagram silently accepts duplicate names — the API just returns a new `collection_id` each time, so dedupe client-side if you care.
- `instagram collection-delete <name-or-id>` calls `POST /api/v1/collections/{id}/delete/`. Pass either a case-insensitive collection name or a numeric `collection_id`. If the name resolves to multiple collections (e.g. duplicates from `collection-create`), the adapter throws and lists the candidate ids so you can disambiguate by passing the id explicitly. Unknown names list the available collections in the error message.
- Saving an existing post directly into a named collection in one shot is not exposed by the web app's documented endpoints (`/api/v1/web/save/{pk}/save/` only writes to "All posts"). Use `instagram save` first, then move the post in the UI, or extend with the `/api/v1/collections/{id}/edit/` mutation.

## Prerequisites

- Chrome running and **logged into** instagram.com
- [Browser Bridge extension](/guide/browser-bridge) installed
