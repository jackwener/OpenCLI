# TikTok

**Mode**: 🔐 Browser · **Domain**: `tiktok.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli tiktok profile` | Get user profile info |
| `opencli tiktok search` | Search videos |
| `opencli tiktok explore` | Trending videos from explore page |
| `opencli tiktok user` | Get recent videos from a user via page-context APIs |
| `opencli tiktok following` | List accounts you follow |
| `opencli tiktok friends` | Friend suggestions |
| `opencli tiktok live` | Browse live streams |
| `opencli tiktok notifications` | Get notifications |
| `opencli tiktok creator-videos` | List TikTok Studio creator videos and metrics |
| `opencli tiktok like` | Like a video |
| `opencli tiktok unlike` | Unlike a video |
| `opencli tiktok save` | Add to Favorites |
| `opencli tiktok unsave` | Remove from Favorites |
| `opencli tiktok follow` | Follow a user |
| `opencli tiktok unfollow` | Unfollow a user |
| `opencli tiktok comment` | Comment on a video |

## Usage Examples

```bash
# View a user's profile
opencli tiktok profile --username tiktok

# Search videos
opencli tiktok search "cooking" --limit 10

# Trending explore videos
opencli tiktok explore --limit 20

# Recent videos from a user
opencli tiktok user dictogo --limit 20

# Browse live streams
opencli tiktok live --limit 10

# List who you follow
opencli tiktok following

# List your TikTok Studio creator videos
opencli tiktok creator-videos --limit 20

# Friend suggestions
opencli tiktok friends --limit 10

# Like/unlike a video
opencli tiktok like --url "https://www.tiktok.com/@user/video/123"
opencli tiktok unlike --url "https://www.tiktok.com/@user/video/123"

# Save/unsave (Favorites)
opencli tiktok save --url "https://www.tiktok.com/@user/video/123"
opencli tiktok unsave --url "https://www.tiktok.com/@user/video/123"

# Follow/unfollow
opencli tiktok follow --username nasa
opencli tiktok unfollow --username nasa

# Comment on a video
opencli tiktok comment --url "https://www.tiktok.com/@user/video/123" --text "Great!"

# JSON output
opencli tiktok profile --username tiktok -f json
```

## Output

### `explore`

| Column | Type | Notes |
|--------|------|-------|
| `index` | int | 1-based position in the recommend feed |
| `id` | string | TikTok video id; round-trips into video URL |
| `author` | string | `uniqueId` of the video author (without `@`) |
| `url` | string | Canonical `https://www.tiktok.com/@author/video/id` |
| `cover` | string | Cover image URL (may be empty) |
| `title` | string | Cleaned description (synonym of `desc`) |
| `desc` | string | Cleaned description (whitespace collapsed, ≤500 chars) |
| `plays` | int \| null | Play count (`null` if upstream did not expose) |
| `likes` | int \| null | Digg count |
| `comments` | int \| null | Comment count |
| `shares` | int \| null | Share count |
| `createTime` | int \| null | Unix seconds when the video was posted |

### `user`

Same video columns as `explore`, plus:

| Column | Type | Notes |
|--------|------|-------|
| `source` | string | `profile-api`, `bootstrap`, or lower-authority `search-fallback` |

`user` resolves the profile `secUid`, pages `/api/post/item_list/`, and uses
exact-author `/api/search/general/full/` only as a fallback when profile data is
short. `source` lets callers distinguish first-party profile rows from fallback
search rows.

### `friends`

| Column | Type | Notes |
|--------|------|-------|
| `index` | int | 1-based position in the suggestion list |
| `username` | string | `uniqueId` of the suggested account (no `@`) |
| `name` | string | Display nickname (falls back to `username`) |
| `secUid` | string | TikTok internal stable id (round-trips into other endpoints) |
| `verified` | bool | `true` when the account carries a verified badge |
| `followers` | int \| null | Follower count if exposed by the suggestion payload |
| `following` | int \| null | Following count if exposed |
| `url` | string | Canonical profile URL |

### `following`

Same column shape as `friends`. `secUid` and follower / following counts come
from `/api/user/list/?scene=21` (TikTok's own following endpoint), which is the
same data their web client renders on the page.

### `notifications`

| Column | Type | Notes |
|--------|------|-------|
| `index` | int | 1-based position |
| `id` | string | Notice id (or `idx-<n>` fallback when upstream omits) |
| `from` | string | `uniqueId` of the actor (without `@`); empty for system notices |
| `text` | string | Cleaned notice text (≤220 chars) |
| `createTime` | int \| null | Unix seconds when the notice fired |

`--type` accepts `all` / `likes` / `comments` / `mentions` / `followers`
(any other value raises `ArgumentError`, no silent default).

### `live`

| Column | Type | Notes |
|--------|------|-------|
| `index` | int | 1-based position |
| `streamer` | string | Host's `uniqueId` (without `@`) |
| `name` | string | Host's display nickname |
| `title` | string | Stream title (≤200 chars, whitespace collapsed) |
| `viewers` | int \| null | Current viewer count |
| `likes` | int \| null | Cumulative like count for the room |
| `secUid` | string | Host's TikTok internal stable id |
| `url` | string | Canonical `/@streamer/live` URL |

## Validation (no silent clamp)

`--limit` is validated upfront and `ArgumentError` is thrown for `0`, negative,
non-integer or out-of-range values — no silent clamp to the cap. Per-command
caps:

| Command | Default | Max |
|---------|--------:|----:|
| `explore` | 20 | 120 |
| `user` | 20 | 120 |
| `friends` | 20 | 100 |
| `following` | 20 | 200 |
| `notifications` | 15 | 100 |
| `live` | 10 | 60 |

`null` semantics: a numeric column returning `null` means upstream did not
expose that field on this row (e.g. some live cards omit `like_count`). A
column never returns `0` as an unknown sentinel. Authentication / empty result
states raise `AuthRequiredError` / `EmptyResultError` instead of returning
empty rows — callers can treat any returned row as real data.

## Implementation Notes

`explore` / `user` / `friends` / `following` / `notifications` / `live` all run inside
the live page (`Strategy.COOKIE` + `browser: true`) and call TikTok's own
internal JSON endpoints with `fetch(..., { credentials: 'include' })`. The
session cookie + `msToken` come from the logged-in browser, the same way
TikTok's web client requests them. Each command first reads the warm
`__UNIVERSAL_DATA_FOR_REHYDRATION__` snapshot for fast first-page results, then
falls back to the corresponding API endpoint when more rows are requested
(`/api/recommend/item_list/`, `/api/user/detail/`, `/api/post/item_list/`,
`/api/search/general/full/`, `/api/recommend/user/`, `/api/user/list/`,
`/api/notice/multi/`, `/api/live/discover/get/`).

This refactor applies the page-context API baseline across TikTok read commands:
typed errors, full numeric stats columns, and no DOM-link scraping.

## Prerequisites

- Chrome running and **logged into** tiktok.com
- [Browser Bridge extension](/guide/browser-bridge) installed
- `creator-videos` requires access to TikTok Studio for the logged-in creator account
