# Macro

**Mode**: 🌐 Public · **Domain**: multiple official macro data sources

Macro collects first-party macroeconomic data entry points for trading analysis,
market research, and macro strategy work. It is based on OpenCLI's public
adapter capability and does not require a browser session or login.

## Commands

| Command | Description |
|---------|-------------|
| `opencli macro overview` | Show the article outline and included sections |
| `opencli macro categories` | List macro source categories |
| `opencli macro sources` | List first-party macro data sources |
| `opencli macro search <query>` | Search sources by keyword, data type, alias, or notes |
| `opencli macro source <id>` | Show details for one source |
| `opencli macro article` | Read the collected article text |
| `opencli macro page <id>` | Fetch useful content links from a source page |

## Usage Examples

```bash
# List collected sources
opencli macro sources

# Search sources useful for energy, CPI, or central bank analysis
opencli macro search 能源
opencli macro search CPI
opencli macro search 央行

# Inspect one source
opencli macro source stats-cn
opencli macro source pbc

# Fetch recent entries from a source page
opencli macro page stats-cn --date 2026-04 --limit 5

# Include detail-page text previews
opencli macro page stats-cn --date 2026-04 --detail --chars 450

# Read raw page text and extracted links
opencli macro page pbc --raw-page --links --chars 1600
```

## Options

### sources

| Option | Description |
|--------|-------------|
| `--category` | Filter by category, such as `cn-national`, `cn-province`, or `international-org` |
| `--limit` | Maximum number of rows to return |

### search

| Option | Description |
|--------|-------------|
| `--category` | Filter search results by category |
| `--limit` | Maximum number of rows to return |

### page

| Option | Description |
|--------|-------------|
| `--url-index` | Select one URL when a source has multiple URLs, starting from 1 |
| `--date` | Filter by `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` |
| `--from` | Start date filter, using `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` |
| `--to` | End date filter, using `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` |
| `--limit` | Maximum number of content items |
| `--detail` | Fetch each item's detail page and include a text preview |
| `--chars` | Maximum text characters for raw page or detail previews |
| `--links` | Include extracted links when using `--raw-page` |
| `--raw-page` | Return the full source page converted to text instead of content items |

## Notes

- Sources are official or first-party macro data entry points, including
  national statistical agencies, central banks, ministries, and international
  organizations.
- The `page` command extracts useful dated links from public HTML pages. Some
  official sites may change markup or throttle requests; retry later if a page
  temporarily fails.
- The adapter is intended as a research starting point for macro strategy and
  trading analysis, not as a normalized economic database.
