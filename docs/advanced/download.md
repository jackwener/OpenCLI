# Download Support

OpenCLI supports downloading images, videos, and articles from supported platforms.

## Supported Platforms

| Platform | Content Types | Notes |
|----------|---------------|-------|
| **xiaohongshu** | Images, Videos | Downloads all media from a note |
| **bilibili** | Videos | Requires `yt-dlp` installed |
| **twitter** | Images, Videos | Downloads from user media tab or single tweet |
| **zhihu** | Articles (Markdown) | Exports articles with optional image download |

## Prerequisites

For video downloads from streaming platforms, install `yt-dlp`:

```bash
# Install yt-dlp
pip install yt-dlp
# or
brew install yt-dlp
```

## Usage Examples

```bash
# Download images/videos from Xiaohongshu note
opencli xiaohongshu download --note_id abc123 --output ./xhs

# Download Bilibili video (requires yt-dlp)
opencli bilibili download --bvid BV1xxx --output ./bilibili
opencli bilibili download --bvid BV1xxx --quality 1080p

# Download Twitter media from user
opencli twitter download --username elonmusk --limit 20 --output ./twitter

# Download single tweet media
opencli twitter download --tweet-url "https://x.com/user/status/123" --output ./twitter

# Export Zhihu article to Markdown
opencli zhihu download --url "https://zhuanlan.zhihu.com/p/xxx" --output ./zhihu

# Export with local images
opencli zhihu download --url "https://zhuanlan.zhihu.com/p/xxx" --download-images
```

## Pipeline Step (YAML Adapters)

The `download` step can be used in YAML pipelines:

::: v-pre
```yaml
pipeline:
  - fetch: https://api.example.com/media
  - download:
      url: ${{ item.imageUrl }}
      dir: ./downloads
      filename: ${{ item.title | sanitize }}.jpg
      concurrency: 5
      skip_existing: true
```
:::
