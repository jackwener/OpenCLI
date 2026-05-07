# Xiaoe (小鹅通)

**Mode**: 🔐 Browser · **Domain**: `study.xiaoe-tech.com` / `*.h5.xet.citv.cn`

## Commands

| Command | Description |
|---------|-------------|
| `opencli xiaoe courses` | List purchased courses with course URLs and shop names |
| `opencli xiaoe detail <url>` | Read course metadata such as title, price, student count, and shop |
| `opencli xiaoe catalog <url>` | Read the full course outline for normal courses, columns, and big columns |
| `opencli xiaoe play-url <url>` | Resolve the M3U8 playback URL for video lessons or live replays |
| `opencli xiaoe content <url>` | Extract rich-text lesson or page content as plain text |

## Usage Examples

```bash
# List purchased courses
opencli xiaoe courses

# Read course metadata
opencli xiaoe detail "https://appxxxx.h5.xet.citv.cn/p/course/ecourse/v_xxxxx"

# Read the course outline
opencli xiaoe catalog "https://appxxxx.h5.xet.citv.cn/p/course/ecourse/v_xxxxx"

# Resolve a lesson M3U8 URL
opencli xiaoe play-url "https://appxxxx.h5.xet.citv.cn/v1/course/video/v_xxxxx?product_id=p_xxxxx" -f json

# Extract page content
opencli xiaoe content "https://appxxxx.h5.xet.citv.cn/v1/course/text/t_xxxxx"
```

## Output

### `content`

| Column | Type | Notes |
|--------|------|-------|
| `title` | string | `document.title` of the rich-text page |
| `content` | string | Trimmed `innerText` from the first matching content selector (`.rich-text-wrap`, `.content-wrap`, `.article-content`, `.text-content`, `.course-detail`, `.detail-content`, `[class*="richtext"]`, `[class*="rich-text"]`, `.ql-editor`); falls through to `<main>` → `#app` → `<body>` if no selector matches. **No silent truncation** — full extracted text is returned. |
| `content_length` | int | `content.length` — useful for caller-side truncation decisions |
| `image_count` | int | Count of `<img>` whose `src` is xiaoe-hosted and not a `data:` URI. No silent slice — counts the entire page. |

Empty `content` (e.g. login expired, page renders an empty shell) raises
`EmptyResultError` instead of returning a row with `content=''`.

### `catalog`

| Column | Type | Notes |
|--------|------|-------|
| `ch` | int | 1-based chapter index |
| `chapter` | string | Chapter title (or course name for column resources) |
| `no` | int | 1-based section index within the chapter |
| `title` | string | Section title |
| `type` | string | Resource label: `图文` / `直播` / `音频` / `视频` / `专栏` / `大专栏`; unknown types pass through as the raw `String(t)` rather than being silently swallowed |
| `resource_id` | string | Xiaoe resource identifier (`p_xxx` / `v_xxx` / `l_xxx` / `a_xxx` / `i_xxx`) |
| `url` | string | Canonical playback / reading URL — `''` when xiaoe did not expose enough fields to construct one (no synthetic URL) |
| `status` | string | `已完成` / `<n>%` / `未学` for normal courses; `已完成` / `<n>节` / `''` for column resources |

### `courses`

| Column | Type | Notes |
|--------|------|-------|
| `title` | string | Course title from the card |
| `shop` | string | Shop name (`shop_name`) or app name (`app_name`); empty when the Vue tree did not expose either |
| `url` | string | Canonical course URL: `entry.h5_url` → `entry.url` → built from `app_id` + `resource_id` (column courses get `/v1/course/column/<id>?type=3`, everything else gets `/p/course/ecourse/<id>`); returns `''` when none of the three are available — never a synthetic partial URL |

## Validation

Empty results raise `EmptyResultError`, never silent `[]` — for browser
adapters this almost always indicates the cookie has expired or the URL
is not a course page. The positional `url` argument is required for `content` /
`catalog` / `detail` / `play-url`; missing `url` raises
`ArgumentError` before any browser navigation happens.

## Prerequisites

- Chrome running and **logged into** the target Xiaoe shop
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `courses` starts from `study.xiaoe-tech.com` and matches purchased course cards back to Vue data to recover shop names and course URLs
- `catalog` supports normal courses, columns, and big columns by reading Vuex / Vue component state after the course page loads
- `play-url` uses a direct API path for video lessons and falls back to runtime resource inspection for live replays
- Cross-shop course URLs are preserved, so you can take a URL from `courses` and pass it directly into `detail`, `catalog`, `play-url`, or `content`
- `catalog`, `courses`, and `content` extract pure helpers (`typeLabel`, `buildItemUrl`, `chapterUrlPath`, `buildCourseUrl`, `pickContentText`, `countXiaoeImages`) that are unit-tested directly in `clis/xiaoe/xiaoe.test.js` — the in-page IIFEs embed those same functions via `${fn.toString()}` so the live and the test paths share one source of truth
