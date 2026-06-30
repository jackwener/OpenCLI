# NodeSeek

**Mode**: 🌐 / 🔐 · **Domain**: `nodeseek.com`

[NodeSeek](https://www.nodeseek.com) is a Chinese community for VPS / hosting / server and other geek topics.

## Commands

| Command | Description |
|---------|-------------|
| `opencli nodeseek latest` | Newest posts (home or `--category` board) |
| `opencli nodeseek categories` | Boards (slug + name) |
| `opencli nodeseek login` | Open NodeSeek login and wait for auth |
| `opencli nodeseek whoami` | Current logged-in account |
| `opencli nodeseek me` | My full profile (auth required) |
| `opencli nodeseek user <id>` | Public profile of a member (auth required) |
| `opencli nodeseek notifications` | My @-me notifications (auth required) |
| `opencli nodeseek post <id>` | Thread body + comment floors (auth required) |
| `opencli nodeseek search <query>` | Full-text post search (auth required) |

## Usage Examples

```bash
# Newest posts, filtered to a board
opencli nodeseek latest --category tech --limit 10

# List boards
opencli nodeseek categories

# A thread with its comment floors (not just the first post)
opencli nodeseek post 779413
opencli nodeseek post 779413 --limit 300        # walk pages to collect up to 300 floors (max 500)
opencli nodeseek post post-779413-1 --full

# Search posts
opencli nodeseek search kamatera --limit 10

# A member's public profile
opencli nodeseek user 6467

# My notifications
opencli nodeseek notifications --unread

# JSON output
opencli nodeseek latest -f json
```

## Prerequisites

`categories` is a static reference and needs **neither browser nor login**.

`latest` reads public pages and needs the browser (to pass Cloudflare) but **no login**:

- Chrome running with the [Browser Bridge extension](/guide/browser-bridge) installed

The remaining commands (`login`, `whoami`, `me`, `user`, `notifications`, `post`, `search`) additionally require being **logged into** nodeseek.com in that browser.

NodeSeek is served behind Cloudflare; the browser bridge passes the challenge using your real session.
