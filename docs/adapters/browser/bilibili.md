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
| `opencli bilibili video` | Get one video's metadata (title, author, duration, stats) by BV / URL / b23.tv link |
| `opencli bilibili summary` | Get the official AI video summary and timestamped outline by BV / URL / b23.tv link |
| `opencli bilibili comments` | Read top-level comments, or read replies under a top-level comment with `--parent` |
| `opencli bilibili comment` | Post a top-level comment or reply under a top-level comment (requires `--execute`) |
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

# Inspect one video's metadata
opencli bilibili video BV1xx411c7mD
opencli bilibili video https://www.bilibili.com/video/BV1xx411c7mD/

# Fetch the official AI summary for a video
opencli bilibili summary BV1xx411c7mD
opencli bilibili summary https://www.bilibili.com/video/BV1xx411c7mD/

# Read comments and a reply thread under a top-level rpid
opencli bilibili comments BV1xx411c7mD --limit 10
opencli bilibili comments BV1xx411c7mD --parent 123456789 --limit 10

# Post a comment or reply. The write only happens with --execute.
opencli bilibili comment BV1xx411c7mD "这条评论来自 OpenCLI" --execute
opencli bilibili comment BV1xx411c7mD "回复楼主" --parent 123456789 --execute

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
- `comments` emits `rpid`; pass a top-level row's `rpid` to `comments --parent` to read its reply thread
- `comments --limit` accepts `1..50`; empty comment lists raise `EmptyResultError`
- `comment` is a write command and refuses to post unless `--execute` is passed
- `comment --parent` expects the top-level/root `rpid`; nested reply-to-reply targeting is not inferred
