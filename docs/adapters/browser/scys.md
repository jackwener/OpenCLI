# SCYS

**Mode**: 🔐 Browser · **Domain**: `scys.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli scys course <url>` | Read SCYS course detail content and chapter context |
| `opencli scys toc <url>` | Extract the chapter outline from a SCYS course detail page |
| `opencli scys read <url>` | Auto-detect the SCYS page type and dispatch to the right extractor |
| `opencli scys feed [url]` | Read SCYS 精华 feed cards with summaries and interactions |
| `opencli scys opportunity [url]` | Read SCYS opportunity cards with AI summaries and tags |
| `opencli scys activity <url>` | Read a SCYS activity landing page timeline |
| `opencli scys article <url>` | Read a SCYS article detail page |

## Usage Examples

```bash
# Read one course chapter
opencli scys course "https://scys.com/course/detail/92"

# Export all deterministic chapters from the TOC
opencli scys course "https://scys.com/course/detail/92" --all -f json

# Download course images while exporting all chapters
opencli scys course "https://scys.com/course/detail/92" --all --download-images --output ./scys-course-downloads -f json

# Extract just the table of contents
opencli scys toc "https://scys.com/course/detail/92" -f json

# Read the essence feed
opencli scys feed "https://scys.com/?filter=essence" -f json

# Read the opportunity page
opencli scys opportunity "https://scys.com/opportunity" -f json

# Read an article detail page
opencli scys article "https://scys.com/articleDetail/xq_topic/55188458224514554" -f json

# Let read auto-dispatch based on URL
opencli scys read "https://scys.com/articleDetail/xq_topic/55188458224514554" -f json
```

## Prerequisites

- Chrome logged into `scys.com`
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `read` dispatches by URL shape and supports course, feed, opportunity, activity, and article pages
- `course --all` expands deterministic chapter IDs from the page TOC and exports each chapter as a separate row
- `course --download-images` stores course images under the output directory and adds `image_dir`/`image_count` fields to the result
- `article`, `feed`, and `opportunity` normalize output to stable JSON field names such as `url`, `raw_url`, `summary`, `content`, and structured `interactions`
