# Discord

Control the **Discord Desktop App** from the terminal via Chrome DevTools Protocol (CDP).

## Prerequisites

Launch with remote debugging port:
```bash
/Applications/Discord.app/Contents/MacOS/Discord --remote-debugging-port=9232
```

## Setup

```bash
export OPENCLI_CDP_ENDPOINT="http://127.0.0.1:9232"
```

## Commands

| Command | Description |
|---------|-------------|
| `opencli discord status` | Check CDP connection |
| `opencli discord send "message"` | Send a message in the active channel |
| `opencli discord read` | Read recent messages |
| `opencli discord channels` | List channels in the current server |
| `opencli discord servers` | List all joined servers |
| `opencli discord search "query"` | Search messages (Cmd+F) |
| `opencli discord members` | List online members |
