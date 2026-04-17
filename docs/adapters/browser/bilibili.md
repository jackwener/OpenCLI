# Bilibili

**Mode**: 🔐 Browser · **Domain**: `bilibili.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli bilibili hot` | |
| `opencli bilibili search` | |
| `opencli bilibili me` | |
| `opencli bilibili favorite` | Read your first favorite folder, or a specific folder with `--fid` |
| `opencli bilibili history` | |
| `opencli bilibili feed` | Read the following feed, or a specific user's dynamics by uid/name |
| `opencli bilibili feed-detail` | Read one dynamic in detail, including exclusive content |
| `opencli bilibili subtitle` | |
| `opencli bilibili dynamic` | |
| `opencli bilibili ranking` | |
| `opencli bilibili following` | |
| `opencli bilibili user-videos` | |
| `opencli bilibili download` | |

## Usage Examples

```bash
# Quick start
opencli bilibili hot --limit 5

# Search videos
opencli bilibili search 黑神话 --limit 10

# Read one creator's videos
opencli bilibili user-videos 2 --limit 10

# Read your first favorite folder
opencli bilibili favorite --limit 10

# Read a specific favorite folder
opencli bilibili favorite --fid 123456789 --limit 10

# Read following feed
opencli bilibili feed --limit 10

# Read one user's dynamics by UID
opencli bilibili feed 2 --limit 10

# Read one user's dynamics by username and paginate
opencli bilibili feed 老番茄 --pages 2 --type video

# Read one dynamic in detail
opencli bilibili feed-detail 1234567890123456789

# Fetch subtitles
opencli bilibili subtitle BV1xx411c7mD --lang zh-CN

# JSON output
opencli bilibili hot -f json

# Verbose mode
opencli bilibili hot -v
```

## Prerequisites

- Chrome running and **logged into** bilibili.com
- [Browser Bridge extension](/guide/browser-bridge) installed

## Notes

- `opencli bilibili feed` without `uid` reads your following feed
- `opencli bilibili feed <uid-or-name>` reads a specific user's dynamics
- `opencli bilibili favorite` defaults to the first favorite folder when `--fid` is omitted
- `feed-detail` expects the dynamic ID from a `https://t.bilibili.com/<id>` URL
