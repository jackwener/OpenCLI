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
| `opencli discord-app status` | Check CDP connection |
| `opencli discord-app send "message"` | Send a message in the active channel |
| `opencli discord-app read` | Read recent messages |
| `opencli discord-app channels` | List channels in the current server |
| `opencli discord-app servers` | List all joined servers |
| `opencli discord-app search "query"` | Search messages (Cmd+F) |
| `opencli discord-app members` | List online members |
| `opencli discord-app delete MESSAGE_ID` | Delete a message by its ID |
