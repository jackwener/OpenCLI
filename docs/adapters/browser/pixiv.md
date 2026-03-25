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
