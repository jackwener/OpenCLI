# Product Hunt

**Mode**: 🌐 Public / 🔐 Browser · **Domain**: `www.producthunt.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli producthunt posts` | Latest Product Hunt launches (optional category filter) |
| `opencli producthunt today` | Today's Product Hunt launches (most recent day in feed) |
| `opencli producthunt hot` | Today's top Product Hunt launches with vote counts |
| `opencli producthunt browse <category>` | Best products in a Product Hunt category |

## Usage Examples

```bash
# Today's top launches with vote counts
opencli producthunt hot --limit 10

# Latest posts (RSS feed)
opencli producthunt posts --limit 20

# Filter by category
opencli producthunt posts --category developer-tools --limit 10

# Today's launches only
opencli producthunt today --limit 10

# Browse best products in a category
opencli producthunt browse vibe-coding --limit 10
opencli producthunt browse ai-agents --limit 10
opencli producthunt browse developer-tools --limit 10

# JSON output
opencli producthunt hot -f json
```

## Category Slugs

Common categories for `browse` and `posts --category`:

`ai-agents`, `ai-coding-agents`, `ai-code-editors`, `ai-chatbots`, `ai-workflow-automation`,
`vibe-coding`, `developer-tools`, `productivity`, `design-creative`, `marketing-sales`,
`no-code-platforms`, `llms`, `finance`, `social-community`, `engineering-development`

## Prerequisites

- `posts` and `today` — no browser required (public RSS feed)
- `hot` and `browse` — Chrome running with [Browser Bridge extension](/guide/browser-bridge) installed
