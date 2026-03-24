# Channel — Platform Event Notifications

Push real-time platform events into your active AI coding session. When something happens on a platform (new tweet, new email, new post), opencli notifies your current Claude Code session automatically.

## How It Works

```
Platform (Twitter, V2EX, GitHub...)
    ↓ polling / webhook
opencli channel server (MCP stdio)
    ↓ notifications/claude/channel
Claude Code session ← you see the notification here
```

The channel server runs as an MCP server with the `claude/channel` experimental capability. It monitors configured platforms and pushes events into your active session via the MCP protocol.

## Quick Start

### 1. Configure sources

Create `~/.opencli/channel.yaml`:

```yaml
sources:
  # Poll V2EX hot posts every 60 seconds
  - command: v2ex/hot
    type: polling
    interval: 60
    enabled: true

  # Poll Twitter notifications every 90 seconds
  - command: twitter/notifications
    type: polling
    interval: 90
    enabled: true

webhook:
  enabled: true
  port: 8788
  token: ""          # optional auth token, supports $ENV_VAR
```

### 2. Register MCP server

Add to `~/.claude.json` under `mcpServers`:

```json
{
  "opencli-channel": {
    "command": "npx",
    "args": ["tsx", "/path/to/opencli/src/main.ts", "channel", "start"],
    "type": "stdio"
  }
}
```

Or if opencli is installed globally:

```json
{
  "opencli-channel": {
    "command": "opencli",
    "args": ["channel", "start"],
    "type": "stdio"
  }
}
```

### 3. Launch Claude Code with channel

```bash
claude --dangerously-load-development-channels server:opencli-channel
```

That's it! Platform events will now push into your session automatically.

## CLI Commands

```bash
opencli channel start    # Start MCP stdio server (called by Claude Code)
opencli channel status   # Show running channel server status
opencli channel stop     # Stop the running channel server
```

## Configuration Reference

### `~/.opencli/channel.yaml`

```yaml
sources:
  - command: <site/name>     # opencli command to poll (e.g. twitter/timeline)
    type: polling            # event source type
    interval: 60             # seconds between polls (minimum: 30)
    enabled: true            # toggle source on/off
    dedupField: id           # optional: override dedup key field

webhook:
  enabled: true              # enable webhook HTTP receiver
  port: 8788                 # HTTP port (localhost only)
  token: ""                  # Bearer token auth (empty = no auth)
                             # supports $ENV_VAR syntax
```

### Polling Sources

Any opencli command that returns a list can be used as a polling source. The channel server runs the command periodically, compares results with the previous snapshot, and pushes new items as notifications.

**Dedup key priority:** `id` > `url` > `title` > SHA-256 hash. Override with `dedupField` for platforms with custom ID fields (e.g. `dedupField: bvid` for Bilibili).

**Example sources:**

| Command | What it monitors |
|---------|-----------------|
| `v2ex/hot` | V2EX hot posts |
| `twitter/notifications` | Twitter mentions & replies |
| `twitter/timeline` | New tweets from follows |
| `bilibili/dynamic` | Bilibili followee updates |
| `reddit/hot` | Reddit hot posts |
| `jike/notifications` | Jike notifications |
| `bloomberg/feeds` | Bloomberg news |

### Webhook Source

The webhook source listens for HTTP POST requests on localhost. External services (CI, monitoring, custom scripts) can push events:

```bash
curl -X POST http://127.0.0.1:8788/events \
  -H "Content-Type: application/json" \
  -d '{"source": "github", "event": "push", "message": "New push to main branch"}'
```

**Payload format:**

| Field | Type | Description |
|-------|------|-------------|
| `source` | string | Platform name (e.g. "github") |
| `event` | string | Event type (e.g. "push", "new_email") |
| `message` | string | Human-readable event summary |
| `data` | object | Optional raw event data |

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Poll fails | Exponential backoff (×2, ×4, max 5min), one notification to user |
| Cookie/auth expired | Pauses source, notifies user |
| Queue overflow (>200) | Discards oldest events silently |
| Claude Code disconnects | Graceful shutdown, releases lock |

## Architecture

- **Read-only / push-only** — The channel only monitors and notifies. All platform actions (reply, like, etc.) go through normal `opencli` commands.
- **Pluggable event sources** — `EventSource` interface supports polling, webhook, and future extension-based monitoring.
- **Single instance** — Lock file prevents duplicate channel servers.
- **Browser lock** — Cross-process coordination prevents conflicts between channel polling and interactive opencli usage.

## Requirements

- Claude Code v2.1.80+ (Channels is a research preview feature)
- `claude.ai` login (API key auth not supported for Channels)
- Team/Enterprise orgs must enable Channels in admin settings
