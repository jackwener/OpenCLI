# Anthropic

**Mode**: Browser / **Domain**: `www.anthropic.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli anthropic download --url <url>` | Download an Anthropic article as Markdown with YAML frontmatter and local images |

## Usage Examples

```bash
# Export an Anthropic news article to Markdown
opencli anthropic download \
  --url "https://www.anthropic.com/news/claude-haiku-4-5" \
  --output ./anthropic-articles

# Export an engineering article
opencli anthropic download \
  --url "https://www.anthropic.com/engineering/building-effective-agents" \
  --output ./anthropic-articles

# Export without downloading images
opencli anthropic download \
  --url "https://www.anthropic.com/news/claude-haiku-4-5" \
  --download-images false
```

## Output

`download` writes one Markdown file and, when image download is enabled, a sibling assets directory:

- `YYYY-MM-DD-title.md` - Markdown with YAML frontmatter and article body
- `YYYY-MM-DD-title_assets/` - cover and body images referenced by relative paths

The frontmatter includes:

- `title`
- `date`
- `author`
- `site`
- `source_url`
- `description`
- `cover`
- `downloaded_at`
- `image_count`

The command supports article URLs under `https://www.anthropic.com/`, including engineering, news, and research/index-style pages.

## Prerequisites

- Chrome running
- [Browser Bridge extension](/guide/browser-bridge) installed
