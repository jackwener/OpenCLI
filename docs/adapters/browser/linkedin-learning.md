# LinkedIn Learning

**Mode**: 🔐 Browser + Cookie · **Domain**: `linkedin.com`

Read-only adapter for LinkedIn Learning courses, videos, and learning paths. Shares cookie session with linkedin.com, no Commercial Use Limit (Learning queries are separate from people-search CUL).

## Commands

| Command | Description |
|---------|-------------|
| `opencli linkedin-learning search` | Search courses, videos, and paths by keyword via `learning-api/searchV2` |
| `opencli linkedin-learning trending` | Browse personalized recommendation carousels via `learning-api/feedRecommendationGroups` |
| `opencli linkedin-learning course` | Course detail by slug or full `/learning/<slug>` URL via `learning-api/courses?q=slug` |

## Usage Examples

```bash
# Search
opencli linkedin-learning search "AI agent"
opencli linkedin-learning search "rust programming" --limit 20

# Personalized recommendations
opencli linkedin-learning trending --limit 10

# Course detail (slug or full URL)
opencli linkedin-learning course agentic-ai-build-your-first-agentic-ai-system
opencli linkedin-learning course https://www.linkedin.com/learning/agentic-ai-build-your-first-agentic-ai-system

# JSON output
opencli linkedin-learning search "data science" -f json
```

## Columns

### `search`

| Column | Notes |
|--------|-------|
| `rank` | 1-based position in upstream order |
| `type` | `COURSE` / `VIDEO` / `LEARNING_PATH` / etc |
| `title` | From `headline.title.text` |
| `instructor` | Joined `firstName lastName` of all authors |
| `difficulty` | `BEGINNER` / `INTERMEDIATE` / etc (uppercase from searchV2) |
| `duration_sec` | Length in seconds (empty if non-SECOND unit) |
| `rating` | Average rating to 2 decimals, computed from `ratingSum/ratingCount` if no `averageRating` |
| `rating_count` | Number of ratings |
| `viewers` | Cumulative viewer count |
| `url` | `https://www.linkedin.com/learning/<slug>` |

### `trending`

| Column | Notes |
|--------|-------|
| `rank` | 1-based across all carousels in document order |
| `group` | Carousel title (e.g. "Top picks for you") or annotation (`TOP_PICKS`) |
| `type` | Same as `search` |
| `title` | Course / video title |
| `difficulty` | Same as `search` |
| `viewers` | Cumulative viewer count |
| `url` | Course URL |

Cards are deduplicated by slug across carousels (first-seen wins).

### `course`

| Column | Notes |
|--------|-------|
| `title` | Course title |
| `slug` | Stable slug used in URL |
| `description` | Full course description returned by `/learning-api/courses?q=slug` |
| `difficulty` | `Beginner` / `Intermediate` / etc (mixed case from detail endpoint) |
| `duration_sec` | Total length in seconds |
| `videos_count` | Number of videos in the course |
| `rating` | Average rating to 2 decimals (empty when `/courses?q=slug` omits ratings; see Caveats) |
| `rating_count` | Number of ratings (empty when omitted) |
| `released` | Activation date (`YYYY-MM-DD`) |
| `url` | `https://www.linkedin.com/learning/<slug>` |

## Prerequisites

- Chrome running with [Browser Bridge extension](/guide/browser-bridge) installed
- Logged in to [linkedin.com](https://linkedin.com); Learning shares the cookie session

## Caveats

- The course-detail endpoint (`/learning-api/courses?q=slug`) does not always include `rating` / `rating_count` even when the `search` endpoint reports them for the same slug. Use `search "<slug words>"` to get ratings if needed; a future revision may make a second call to `/learning-api/reviews?contentUrn=...&q=findByContent` to fill these in.
- `trending` returns personalized recommendations (carousel `annotation: TOP_PICKS` and similar), not a globally-ranked popularity list. The output reflects the logged-in user's recent activity and skills.
- Voyager search-cluster endpoints (used by the standard `linkedin/search` jobs adapter and `linkedin/people-search`) do not serve Learning data; `learning-api/*` is the dedicated REST surface.

## Limit Validation

- `search` and `trending` cap `--limit` at 50 with strict-integer validation (no silent clamp).
- `course` returns exactly one row by definition.
