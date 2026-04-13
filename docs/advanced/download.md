# Download Support

OpenCLI supports downloading images, videos, and articles from supported platforms.

## Supported Platforms

| Platform | Content Types | Notes |
|----------|---------------|-------|
| **xiaohongshu** | Images, Videos | Downloads all media from a note |
| **bilibili** | Videos | Requires `yt-dlp` installed |
| **twitter** | Images, Videos | Downloads from user media tab or single tweet |
| **douban** | Images | Downloads poster / still image lists from movie subjects |
| **zhihu** | Articles (Markdown) | Exports articles with optional image download |
| **weixin** | Articles (Markdown) | Exports WeChat Official Account articles |

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
opencli xiaohongshu download "https://www.xiaohongshu.com/search_result/<id>?xsec_token=..." --output ./xhs
opencli xiaohongshu download "https://xhslink.com/..." --output ./xhs

# Download Bilibili video (requires yt-dlp)
opencli bilibili download --bvid BV1xxx --output ./bilibili
opencli bilibili download --bvid BV1xxx --quality 1080p

# Download Twitter media from user
opencli twitter download elonmusk --limit 20 --output ./twitter

# Download single tweet media
opencli twitter download --tweet-url "https://x.com/user/status/123" --output ./twitter

# Download Douban posters / stills
opencli douban download 30382501 --output ./douban

# Export Zhihu article to Markdown
opencli zhihu download "https://zhuanlan.zhihu.com/p/xxx" --output ./zhihu

# Export with local images
opencli zhihu download "https://zhuanlan.zhihu.com/p/xxx" --download-images

# Export WeChat article to Markdown
opencli weixin download --url "https://mp.weixin.qq.com/s/xxx" --output ./weixin
```

## Pipeline Step

The `download` step can be used in pipeline adapters:

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
