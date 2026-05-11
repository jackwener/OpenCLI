# 1point3acres (一亩三分地)

Browse and search **1point3acres** — a Discuz!-based BBS popular for North American job, immigration, and grad-school discussions. Public listings work without auth; `search` and `notifications` require an active browser session.

**Mode**: 🌐 Public + 🔐 Cookie · **Domain**: `www.1point3acres.com`

## Commands

| Command | Description | Auth |
|---------|-------------|------|
| `opencli 1point3acres hot` | Today's hot threads (by heat) | Public |
| `opencli 1point3acres latest` | Newest threads (by post time, desc) | Public |
| `opencli 1point3acres digest` | Editor-picked / featured threads | Public |
| `opencli 1point3acres forums` | List all forums (fid + name) | Public |
| `opencli 1point3acres forum <fid>` | List threads in a specific forum | Public |
| `opencli 1point3acres thread <tid>` | Thread detail + replies | Public |
| `opencli 1point3acres user <who>` | User profile (group / points / 大米 / posts) | Public |
| `opencli 1point3acres search <query>` | Full-text search | Cookie |
| `opencli 1point3acres notifications` | Site notifications (replies / mentions / reviews) | Cookie |

## Usage Examples

```bash
# Today's hot threads
opencli 1point3acres hot --limit 10

# Newest posts in the overseas-job-referral forum (fid=198)
opencli 1point3acres forum 198 --limit 20

# Read a thread (tid comes from any listing's `tid` column)
opencli 1point3acres thread 1158360 --limit 10

# Lookup a user (numeric → uid, otherwise username)
opencli 1point3acres user 12345
opencli 1point3acres user some-username

# Filter the forum list by keyword
opencli 1point3acres forums --filter 面经

# Search the site (requires login)
opencli 1point3acres search "OPT extension" --limit 10

# Notifications (requires login)
opencli 1point3acres notifications --kind mypost --limit 20
```

## Common Forum IDs

`145` (海外面经) · `198` (海外职位内推) · `27` (研究生申请) · `28` (博士申请) · `82` (NIW / EB-1A 移民).
Use `opencli 1point3acres forums` to see the full list.

## Output Columns

| Command | Columns |
|---------|---------|
| `hot` / `latest` / `digest` / `forum` | `rank, tid, title, forum, author, replies, views, lastReplyTime, url` |
| `thread` | `floor, pid, author, postTime, content, url` |
| `user` | `uid, username, group, credits, rice, posts, threads, digests, registerTime, lastAccess, profileUrl` |
| `forums` | `fid, name, url` |
| `search` | `rank, tid, title, forum, author, replies, views, postTime, url` |
| `notifications` | `index, from, summary, time, threadUrl` |

## Prerequisites

- No browser required for public commands (`hot` / `latest` / `digest` / `forums` / `forum` / `thread` / `user`)
- For `search` and `notifications`:
  - Chrome is running
  - You are already logged in to `www.1point3acres.com`
  - [Browser Bridge extension](/guide/browser-bridge) is installed

## Notes

- The site serves GBK-encoded HTML; the adapter decodes to UTF-8 internally
- `tid` (thread id) is the canonical handle that pipes a listing row into `thread` for the full content
- Public endpoints serve rendered HTML, so heavy bot traffic may hit Discuz challenge / login gates — fall back to a logged-in session if `hot` / `latest` start returning empty rows
- Listing `--limit` values are validated upfront and rejected with `ArgumentError` if non-positive or above 50 (the page yields ~50 rows max) — no silent clamp
- `thread --page`, `thread --limit`, `thread --contentLimit`, and `notifications --limit` also reject invalid values explicitly instead of silently flooring them
