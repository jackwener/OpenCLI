# GitHub Trending

**Mode**: 🌐 Public · **Domain**: `github.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli github-trending repos` | List repositories from GitHub Trending |

## Usage Examples

```bash
# Daily trending repositories
opencli github-trending repos --limit 10

# Weekly Rust trending repositories
opencli github-trending repos --language rust --since weekly --limit 10

# Language slugs are URL-encoded before calling github.com/trending
opencli github-trending repos --language "c++" --since monthly -f json
```

## Arguments

| Argument | Description |
|----------|-------------|
| `--since` | Time range: `daily`, `weekly`, or `monthly` (default: `daily`) |
| `--language` | Optional GitHub Trending language slug, for example `python`, `rust`, or `c++` |
| `--limit` | Number of repositories to return, 1-25 |

## Output Columns

`rank`, `repo`, `description`, `language`, `stars`, `forks`, `starsSince`, `url`

## Notes

- This command reads the public server-rendered `https://github.com/trending` page. GitHub does not expose an official REST endpoint for Trending.
- It does not use the logged-in GitHub browser session and does not call `gh`.
- Parser drift is treated as a command execution error. A true empty result requires GitHub's explicit empty-state page.
