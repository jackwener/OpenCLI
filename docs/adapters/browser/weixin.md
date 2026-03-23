# WeChat (微信公众号)

**Mode**: 🔐 Browser · **Domain**: `mp.weixin.qq.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli weixin download` | 下载微信公众号文章为 Markdown 格式 |

## Usage Examples

```bash
# Export article to Markdown
opencli weixin download --url "https://mp.weixin.qq.com/s/xxx" --output ./weixin

# Export with locally downloaded images
opencli weixin download --url "https://mp.weixin.qq.com/s/xxx" --download-images

# Export without images
opencli weixin download --url "https://mp.weixin.qq.com/s/xxx" --no-download-images
```

## Output

Downloads to `<output>/<article-title>/`:
- `<article-title>.md` — Markdown with frontmatter (title, author, publish time, source URL)
- `images/` — Downloaded images (if `--download-images` is enabled, default: true)

## Prerequisites

- Chrome running and **logged into** mp.weixin.qq.com (for articles behind login wall)
- [Browser Bridge extension](/guide/browser-bridge) installed
