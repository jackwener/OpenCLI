# Pixiv

**Mode**: 🔐 Browser · **Domain**: `www.pixiv.net`

## Commands

| Command | Description |
|---------|-------------|
| `opencli pixiv ranking` | Daily/weekly/monthly illustration rankings |
| `opencli pixiv search <query>` | Search illustrations by keyword or tag |
| `opencli pixiv user <uid>` | View artist profile info |
| `opencli pixiv illusts <user-id>` | List illustrations by artist |
| `opencli pixiv detail <id>` | View illustration details |
| `opencli pixiv download <illust-id>` | Download original-quality images |
| `opencli pixiv novel <id>` | View novel metadata |
| `opencli pixiv novel-search <query>` | Search novels by keyword or tag |
| `opencli pixiv novels <user-id>` | List novels by user |
| `opencli pixiv novel-series <id>` | List novels in a novel series |

## Output Columns

| Command | Columns |
|---------|---------|
| `ranking` | `rank, title, author, user_id, illust_id, pages, bookmarks, url` |
| `search` | `rank, title, author, user_id, illust_id, pages, bookmarks, tags, url` |
| `illusts` | `rank, title, illust_id, pages, bookmarks, tags, created, url` |
| `user` | `user_id, name, premium, following, illusts, manga, novels, comment, url` |
| `detail` | `illust_id, title, author, type, pages, bookmarks, likes, views, tags, created, url` |
| `novel` | `novel_id, title, author, user_id, series_id, series_title, series_order, words, characters, bookmarks, likes, views, tags, created, url` |
| `novel-search` | `rank, title, author, user_id, novel_id, words, characters, bookmarks, tags, created, url` |
| `novels` | `rank, title, novel_id, words, characters, bookmarks, tags, created, url` |
| `novel-series` | `order, novel_id, title, author, words, characters, bookmarks, tags, created, url` |

`illust_id` round-trips from `ranking` / `search` / `illusts` into `detail` / `download`. `novel_id` round-trips from `novels` / `novel-series` into `novel`. `user_id` round-trips from `ranking` / `search` into `user` / `illusts` / `novels`.

## Usage Examples

### Ranking

```bash
# Daily rankings (default)
opencli pixiv ranking --limit 10

# Weekly / monthly rankings
opencli pixiv ranking --mode weekly
opencli pixiv ranking --mode monthly

# R18 rankings
opencli pixiv ranking --mode daily_r18
opencli pixiv ranking --mode weekly_r18

# Other modes: rookie, original, male, female
opencli pixiv ranking --mode rookie
```

### Search

```bash
# Search by keyword or tag
opencli pixiv search "初音ミク" --limit 20

# Filter by content rating
opencli pixiv search "風景" --mode safe       # Safe-for-work only
opencli pixiv search "風景" --mode r18        # R18 only
opencli pixiv search "風景" --mode all        # All (default)

# Sort by popularity
opencli pixiv search "VOCALOID" --order popular_d

# All sort options: date_d (newest), date (oldest), popular_d, popular_male_d, popular_female_d

# Pagination
opencli pixiv search "オリジナル" --page 2 --limit 30
```

### User & Illustrations

```bash
# View artist profile
opencli pixiv user 11

# List artist's illustrations (newest first)
opencli pixiv illusts 11 --limit 10

# View illustration details (tags, stats, type)
opencli pixiv detail 12345678
```

### Novels

```bash
# View novel metadata
opencli pixiv novel 10588915

# Search novels by keyword or tag
opencli pixiv novel-search "ファンタジー" --mode r18 --limit 20

# List a user's novels (newest first)
opencli pixiv novels 37119297 --limit 10

# List entries in a novel series
opencli pixiv novel-series 1064235 --limit 30
```

Novel commands expose metadata, IDs, tags, series fields, and stats. They do not emit the full novel body text.

### Download

```bash
# Download all images from an illustration
opencli pixiv download 12345678

# Download to a custom directory
opencli pixiv download 12345678 --output ./my-images
```

### Output Formats

```bash
# JSON output
opencli pixiv ranking -f json

# Verbose mode
opencli pixiv search "test" -v
```

## Prerequisites

- Chrome running and **logged into** pixiv.net
- [Browser Bridge extension](/guide/browser-bridge) installed
