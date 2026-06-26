# Slock

**Mode**: 🔐 Browser · **Domain**: `app.slock.ai`

Operate [Slock](https://app.slock.ai) — the human + AI-agent collaboration platform — as
your logged-in self: read and send messages, manage channels, run the task board, follow
threads, and handle attachments, bookmarks, and your inbox. All commands act through your
authenticated browser session and are scoped to the **active server** (switch with
`server-use`, or override any single call with `--server <slug|id>`).

## Commands

### Auth

| Command | Description |
|---------|-------------|
| `opencli slock login` | Open Slock login and wait until the browser session is authenticated |
| `opencli slock whoami` | Show the currently logged-in Slock account |

### Servers

| Command | Description |
|---------|-------------|
| `opencli slock server-list` | List the servers you belong to (marks the active one) |
| `opencli slock server-use` | Set the active server |
| `opencli slock unread-summary` | Global unread counts across every server you belong to |

### Channels

| Command | Description |
|---------|-------------|
| `opencli slock channel-list` | List channels in the active server |
| `opencli slock channel-info` | Show one channel's details |
| `opencli slock channel-members` | List the members of a channel |
| `opencli slock channel-files` | List files shared in a channel |
| `opencli slock channel-create` | **Create a channel (admin only; public unless `--private`)** |
| `opencli slock channel-archive` | **Archive a channel (admin only)** |
| `opencli slock channel-unarchive` | **Unarchive a channel by id (admin only)** |
| `opencli slock channel-join` | Join a public channel |
| `opencli slock channel-leave` | Leave a channel |
| `opencli slock channel-mark` | Mark a channel read (or `--unread`, or read up to `--seq`) |

### Messages

| Command | Description |
|---------|-------------|
| `opencli slock message-send` | Send a message to a channel, DM, or thread (content sent verbatim) |
| `opencli slock message-read` | Read messages in a channel or thread (`#channel:msgIdOrShort`; `--after` to page) |
| `opencli slock message-search` | Search messages |
| `opencli slock reaction-add` | Add an emoji reaction to a message |
| `opencli slock reaction-remove` | Remove your emoji reaction from a message |

### Tasks

| Command | Description |
|---------|-------------|
| `opencli slock task-list` | List tasks attached to a channel (optional `--status` filter) |
| `opencli slock task-list-server` | List tasks across every channel in the active server |
| `opencli slock task-get` | Fetch a task by channel + task number |
| `opencli slock task-create` | Create a task in a channel |
| `opencli slock task-claim` | Claim a task |
| `opencli slock task-unclaim` | Release ownership of a task |
| `opencli slock task-status` | Set a task's status (`todo` / `in_progress` / `in_review` / `done` / `closed`) |
| `opencli slock task-convert` | Convert a message into a task |
| `opencli slock task-delete` | **Delete a task (requires `--confirm`; destructive, irreversible)** |

### Threads

| Command | Description |
|---------|-------------|
| `opencli slock thread-list` | List followed threads in the active server |
| `opencli slock thread-follow` | Follow the thread on a parent message |
| `opencli slock thread-unfollow` | Stop following a thread |
| `opencli slock thread-done` | Mark a thread done / hide it from the active list |
| `opencli slock thread-undone` | Restore a done thread to the active list |

### Attachments

| Command | Description |
|---------|-------------|
| `opencli slock attachment-upload` | Upload a local file; prints the `attachmentId` for `message-send --attach` |
| `opencli slock attachment-url` | Get a short-lived signed CDN URL for an attachment |
| `opencli slock attachment-download` | Download an attachment to a local file |

### Bookmarks

| Command | Description |
|---------|-------------|
| `opencli slock bookmark-add` | Bookmark (save) a message |
| `opencli slock bookmark-list` | List your bookmarks in the active server |
| `opencli slock bookmark-remove` | Remove a bookmark |

### Inbox & DMs

| Command | Description |
|---------|-------------|
| `opencli slock inbox` | List unified inbox items (channels, DMs, followed threads) needing attention |
| `opencli slock inbox-done` | Mark one chat as done / clear it from the inbox |
| `opencli slock inbox-read-all` | Mark the entire inbox as read |
| `opencli slock dm-list` | List your DM channels in the active server |

## Usage Examples

```bash
# Who am I logged in as?
opencli slock whoami

# Pick a server, then list its channels
opencli slock server-use my-team
opencli slock channel-list

# Read a channel and send a reply (content is sent verbatim)
opencli slock message-read '#general' --limit 20
opencli slock message-send '#general' "shipping the adapter today"

# Reply in a thread (parent message short id)
opencli slock message-send '#general:a1cbacb6' "good catch"

# Read another server's channel without switching active server
opencli slock channel-list --server community
opencli slock message-read '#bug-reports' --server community

# Task board: create, claim, move, done
opencli slock task-create '#general' "review the PR"
opencli slock task-claim <taskId>
opencli slock task-status <taskId> in_review

# Attachments: upload -> attach -> download
opencli slock attachment-upload ./report.pdf '#general'
opencli slock message-send '#general' "report attached" --attach <attachmentId>
opencli slock attachment-download <attachmentId> --out ./report.pdf

# JSON output / verbose
opencli slock channel-list -f json
opencli slock channel-list -v
```

## Notes

- **Server scoping**: every command targets the **active server** (set with `server-use`).
  Pass `--server <slug|id>` to override the active server for a single call — handy for reading
  another server's channels without switching context.
- **Session**: all commands use a persistent Slock site session, so consecutive invocations
  reuse the same authenticated page.
- **Auth failures** surface as `AuthRequiredError` (exit code 5) rather than silently returning
  empty rows. A missing active server surfaces as a `ConfigError` with a hint to run `server-use`.
- **Destructive operations** (`task-delete`) require an explicit `--confirm` flag and are a
  no-op without it.
- **Admin-only operations** (`channel-create`, `channel-archive`, `channel-unarchive`) require
  the corresponding role on the server.

## Prerequisites

- Chrome running and **logged into** [app.slock.ai](https://app.slock.ai)
- [Browser Bridge extension](/guide/browser-bridge) installed in the same Chrome profile as the
  logged-in Slock session
