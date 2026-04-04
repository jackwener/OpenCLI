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
opencli xiaoe courses --limit 10

# Read course metadata
opencli xiaoe detail "https://appxxxx.h5.xet.citv.cn/p/course/ecourse/v_xxxxx"

# Read the course outline
opencli xiaoe catalog "https://appxxxx.h5.xet.citv.cn/p/course/ecourse/v_xxxxx"

# Resolve a lesson M3U8 URL
opencli xiaoe play-url "https://appxxxx.h5.xet.citv.cn/v1/course/video/v_xxxxx?product_id=p_xxxxx" -f json

# Extract page content
opencli xiaoe content "https://appxxxx.h5.xet.citv.cn/v1/course/text/t_xxxxx"
```

## Prerequisites

- Chrome running and **logged into** the target Xiaoe shop
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `courses` starts from `study.xiaoe-tech.com` and matches purchased course cards back to Vue data to recover shop names and course URLs
- `catalog` supports normal courses, columns, and big columns by reading Vuex / Vue component state after the course page loads
- `play-url` uses a direct API path for video lessons and falls back to runtime resource inspection for live replays
- Cross-shop course URLs are preserved, so you can take a URL from `courses` and pass it directly into `detail`, `catalog`, `play-url`, or `content`
