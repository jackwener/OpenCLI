# Behance

**Mode**: 🌐 Public · **Domain**: `behance.net`

Search public Behance projects without a browser session or Adobe login.

## Commands

| Command | Description |
|---------|-------------|
| `opencli behance search <query>` | Search public projects and return visible project-card metadata |

## Usage Examples

```bash
# Search for brand identity projects
opencli behance search "brand identity" --limit 12

# Machine-readable output
opencli behance search "industrial branding" --limit 5 -f json
```

## Output Columns

| Column | Description |
|--------|-------------|
| `rank` | 1-indexed result position |
| `projectId` | Stable Behance project ID |
| `title` | Project title |
| `author` | Visible owner name when the card exposes one; otherwise `null` |
| `appreciations` | Visible appreciation count |
| `views` | Visible view count |
| `thumbnailUrl` | Project cover image URL when available |
| `url` | Canonical Behance project URL without tracking parameters |

## Arguments

- `<query>` is required and positional.
- `--limit` accepts an integer from 1 to 50 and defaults to 20.

## Prerequisites

- No browser or login required. The adapter reads the public server-rendered search page.
