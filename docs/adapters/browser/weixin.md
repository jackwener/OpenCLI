# WeChat (微信公众号)

**Mode**: 🌐 / 🔐 Browser · **Domains**: `weixin.sogou.com`, `mp.weixin.qq.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli weixin search` | 使用搜狗微信搜索公众号文章，返回标题、链接、摘要和发布时间 |
| `opencli weixin download` | 下载微信公众号文章为 Markdown 格式 |
| `opencli weixin drafts` | 列出公众号后台草稿箱中的图文草稿 |
| `opencli weixin create-draft` | 在公众号后台创建新的图文草稿 |

## Usage Examples

```bash
# Search Official Account articles through Sogou Weixin
opencli weixin search "AI" --page 1 --limit 5

# Export the corresponding WeChat article URL to Markdown
opencli weixin download --url "https://mp.weixin.qq.com/s/xxx" --output ./weixin

# Export article to Markdown
opencli weixin download --url "https://mp.weixin.qq.com/s/xxx" --output ./weixin

# Export with locally downloaded images
opencli weixin download --url "https://mp.weixin.qq.com/s/xxx" --download-images

# Export without images
opencli weixin download --url "https://mp.weixin.qq.com/s/xxx" --no-download-images

# List the latest drafts
opencli weixin drafts --limit 5

# Create a draft article
opencli weixin create-draft --title "周报" --author "OpenCLI" --summary "本周更新摘要" "这里是正文内容"

# Create a draft with a cover image sourced from local disk
opencli weixin create-draft --title "封面示例" --cover-image ./cover.png "正文会先插入图片，再设为封面"
```

## Output

`search` returns one row per Sogou Weixin result:
- `rank` — overall result rank based on the requested page
- `page` — Sogou result page number
- `title` — article title
- `url` — Sogou result link for the article
- `summary` — result-page snippet, when available
- `publish_time` — time text rendered by Sogou, such as `27分钟前` or `2小时前`

Use `weixin download` with the corresponding `mp.weixin.qq.com` article URL when you need Markdown content extraction.

Downloads to `<output>/<article-title>/`:
- `<article-title>.md` — Markdown with frontmatter (title, author, publish time, source URL)
- `images/` — Downloaded images (if `--download-images` is enabled, default: true)

## Prerequisites

- Chrome running and **logged into** mp.weixin.qq.com (for articles behind login wall)
- [Browser Bridge extension](/guide/browser-bridge) installed
- `create-draft` with `--cover-image` requires Browser Bridge file upload support
