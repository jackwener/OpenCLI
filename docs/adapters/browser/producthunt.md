# Product Hunt

**Mode**: 🌐 Public / 🔐 Browser · **Domain**: `www.producthunt.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli producthunt posts` | Latest Product Hunt launches by launch date, no votes/rank (optional category filter) |
| `opencli producthunt today` | Product Hunt daily leaderboard (rank + votes) for a given day |
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

# A specific day's leaderboard (default: today in US/Pacific)
opencli producthunt today --limit 10
opencli producthunt today --date 2026-08-22 --limit 10

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

- `posts` — no browser required (public Atom feed)
- `today`, `hot` and `browse` — Chrome running with [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- producthunt.com serves a Cloudflare managed challenge to plain HTTP clients
  (`403` + `cf-mitigated: challenge`), so every page-backed command needs the browser bridge.
  Only `https://www.producthunt.com/feed` is reachable without it.
- `today`, `hot` and `browse` read the page's hydrated Apollo store
  (`window.__APOLLO_CLIENT__`), not intercepted XHR: these pages are server rendered,
  so nothing matching fires on the wire after navigation.
- The Atom feed is ordered by `<updated>`, not `<published>`. `posts` re-sorts by launch
  date. The feed carries no rank and no vote count — use `today` or `hot` for those.
- `rank` means different things per command: `today` = real daily leaderboard rank,
  `hot` = list position by vote count on the homepage (which mixes daily/weekly/monthly
  rails), `posts` = list position only.
