# Weibo `search_by_user` Command Design

## Goal

Add a `search_by_user` command to the Weibo adapter that fetches a user's posts within a specified time range, resolves long-text content, downloads images, and outputs structured Markdown files — enabling archival and offline reading.

## Motivation

The current Weibo adapter has no way to search a user's timeline by date range. The existing `search` command only does keyword search via DOM scraping. Users need to batch download a specific user's posts with original text, images, and metadata for archival purposes. A Chrome extension plugin (`weibo-extend`) already proved the `searchProfile` API works for this use case.

## Command Interface

```
opencli weibo search_by_user <uid|screen_name> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--start <date>` | 30 days ago | Start date (YYYY-MM-DD) |
| `--end <date>` | today | End date (YYYY-MM-DD) |
| `--has-retweet` | false | Include retweets |
| `--has-video` | false | Include posts with video |
| `--has-music` | false | Include posts with music |
| `--limit <n>` | 0 (all) | Maximum posts to fetch |
| `--output <dir>` | `./weibo_<uid>_<start>_<end>/` | Output directory |

## Architecture

### Data Fetching Flow

```
search_by_user(uid/screen_name, start, end, options)
  |
  +- 1. If screen_name given, resolve uid via /ajax/profile/info
  |
  +- 2. Convert YYYY-MM-DD to Unix timestamp (seconds) for starttime/endtime
  |
  +- 3. Paginated calls to searchProfile API
  |     GET /ajax/statuses/searchProfile?uid=O&page=N&starttime=X&endtime=Y&...
  |     - Start at page=1, ~5 posts per page
  |     - Stop when list.length <= 5 or --limit reached
  |     - All calls via page.evaluate() + fetch + credentials: 'include'
  |
  +- 4. Per post processing:
  |     - isLongText -> call /ajax/statuses/longtext for full text
  |     - Extract pic_infos image URLs
  |     - Extract retweeted_status (if retweet)
  |
  +- 5. Write output files
```

### Output File Structure

```
weibo_<uid>_<start>_<end>/
|-- SUMMARY.md              # Table of all posts
|-- post_<idstr>.md          # Individual post Markdown
|-- <idstr>_images/          # Images for this post
|   |-- 1.jpg
|   |-- 2.jpg
|   ...
|-- post_<idstr2>.md
|-- <idstr2>_images/
    ...
```

### Single Post Markdown Format

```markdown
---
author: username
uid: 1234567890
time: 2025-12-01 10:30:00
url: https://weibo.com/1234567890/QD5uq0ydj
likes: 1234
comments: 56
reposts: 12
---

Post content in Markdown format

![image1](post_QD5uq0ydj_images/1.jpg)
![image2](post_QD5uq0ydj_images/2.jpg)
```

### Summary Markdown

A table listing all fetched posts with: ID, text preview (first 80 chars), time, likes/comments/reposts, URL.

## Implementation Details

### HTML to Markdown Conversion

- Use `turndown` (already a project dependency) to convert `text_raw` HTML to Markdown
- Configure TurndownService to preserve image links and convert `<br>` to newlines
- Strip Weibo-specific HTML artifacts (emojis, at-mentions wrapper spans)

### Image Download

- Extract `pic_infos[].large.url` from post data
- Use existing `httpDownload()` from `src/download/index.ts`
- Pass `Referer: https://weibo.com` header for CDN access
- Pass browser cookies via `formatCookieHeader(page.getCookies(...))`
- Name images sequentially: `1.jpg`, `2.jpg` in `<idstr>_images/`
- On download failure: keep original URL in Markdown, skip image

### Long Text Resolution

- Check `post.isLongText || post.is_long_text` flag
- If true, fetch `/ajax/statuses/longtext?id=<idstr>` for `data.longTextContent`
- Use existing pattern from `post.js` (lines 33-41)
- On failure: fallback to original `text_raw`

### Consistency with Existing Adapter

- Follow existing Weibo adapter patterns: `page.evaluate()` with inline IIFE, `fetch()`, `credentials: 'include'`
- Use existing error types: `OpenCLIAuthError`, `OpenCLINotFoundError`
- Reuse `sanitizeFilename()` from download utilities
- File structure: new `search_by_user.js` in `clis/weibo/`

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Not logged in / cookies expired | `OpenCLIAuthError`, suggest `opencli doctor` |
| screen_name resolution fails | `OpenCLINotFoundError`, suggest checking name |
| Empty result set | Print "no posts in this time range", exit cleanly |
| Single image download fails | Skip, keep original URL in Markdown |
| Long text API fails | Fallback to `text_raw` field |
| Network timeout | Retry page fetch up to 2 times, 1s interval |

## Testing Strategy

- **Unit tests**: Date to timestamp conversion, HTML to Markdown conversion, filename sanitization
- **Integration tests**: Mock searchProfile API responses, verify pagination, long-text fallback, image URL extraction
- **Manual E2E**: Run against real Weibo account with known posts

## Files Changed

| File | Action |
|------|--------|
| `clis/weibo/search_by_user.js` | New - main command implementation |
| `clis/weibo/search_by_user.test.js` | New - unit/integration tests |
| `src/cli.ts` | Modify - register new subcommand |

## Not In Scope

- Video download (handle in future iteration)
- Comment fetching/downloading
- Retweet chain expansion (only include retweet source text inline)
- Recursive follower posts
