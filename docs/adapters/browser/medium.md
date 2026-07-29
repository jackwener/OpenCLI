# Medium

**Mode**: Mixed · **Domain**: `medium.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli medium feed` | Get hot Medium posts, optionally scoped to a topic |
| `opencli medium search` | Search Medium posts by keyword |
| `opencli medium user` | Get recent articles by a user |
| `opencli medium tag <tag>` | Latest articles for a Medium tag (public RSS, no browser) |
| `opencli medium login` | Open the Medium sign-in page and wait for the browser session to authenticate |
| `opencli medium whoami` | Confirm the active Medium account |
| `opencli medium publish <content> --title <title>` | Write and immediately publish a Medium story |

## Usage Examples

```bash
# Get the general Medium feed
opencli medium feed --limit 10

# Search posts by keyword
opencli medium search ai

# Get articles by a user
opencli medium user @username

# Topic feed as JSON
opencli medium feed --topic programming -f json

# Latest articles for a tag (public RSS — fastest, no browser)
opencli medium tag programming --limit 10
opencli medium tag artificial-intelligence --limit 20

# Write and publish a story from the authenticated Chrome session
opencli medium publish "The complete story body." --title "A practical title" --tags ai,writing
```

`publish` fills Medium's `/new-story` editor, opens the publishing dialog, applies optional topic tags, and returns the story URL only after Medium redirects away from the editor.

## `tag` columns

`rank, title, author, description, categories, published, url`

- `description` is the full RSS `<description>` (no silent truncation; pipe through `head` if you want a preview).
- `categories` is comma-joined Medium tags from each item's `<category>` blocks.
- `published` is the original `pubDate` ISO string when available.

## Prerequisites

- `opencli medium search` and `opencli medium tag` can run without a browser (the latter parses `medium.com/feed/tag/<tag>` RSS)
- `opencli medium feed` and `opencli medium user` require Browser Bridge access to `medium.com`
- `opencli medium publish` requires a logged-in Medium browser session; run `opencli medium login` first when needed.
