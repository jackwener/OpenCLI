# youtube

## Commands

### search
- 用途：Search YouTube videos
- 参数：
  - `query`（必填）：Search query
  - `limit`（可选）：类型 int；默认值 20；Max results (max 50)
- 用法：`opencli youtube search [options] -f json`

### transcript
- 用途：Get YouTube video transcript/subtitles
- 参数：
  - `url`（必填）：YouTube video URL or video ID
  - `lang`（可选）：Language code (e.g. en, zh-Hans). Omit to auto-select
  - `mode`（可选）：默认值 'grouped'；Output mode: grouped (readable paragraphs) or raw (every segment)
- 用法：`opencli youtube transcript [options] -f json`

### video
- 用途：Get YouTube video metadata (title, views, description, etc.)
- 参数：
  - `url`（必填）：YouTube video URL or video ID
- 用法：`opencli youtube video [options] -f json`
