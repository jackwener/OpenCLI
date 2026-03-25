# OpenCLI Channel — Event Subscription Protocol

**Subscribe to platform events from the command line.** Channel brings the reverse direction to OpenCLI: instead of you asking platforms for data, platforms tell you when something happens.

## The Idea

OpenCLI today is pull-only: `opencli twitter post`, `opencli notion read`, `opencli gh pr list`. You ask, the platform answers. But what about the other direction?

- A reviewer leaves comments on your GitHub PR → you want your agent to pick them up automatically.
- Someone comments on your Notion doc → you want to be notified and respond.
- A new issue appears in your repo → you want it routed to the right handler.

Channel fills this gap. It's [fetchmail](https://en.wikipedia.org/wiki/Fetchmail) for APIs: poll remote platforms, track what you've already seen, deliver new events to whoever subscribed.

## Quick Start

```bash
# 1. See what sources are available
opencli channel sources

# 2. Subscribe to an issue's comments
opencli channel subscribe github:owner/repo#42

# 3. One-shot poll (prints events as JSON lines)
opencli channel poll github:owner/repo#42

# 4. Start the daemon for continuous polling
opencli channel start

# 5. Check status
opencli channel status

# 6. Stop the daemon
opencli channel stop
```

## Architecture

```
┌─ opencli channel ─────────────────────────────────────┐
│                                                        │
│  Sources (platform adapters):                          │
│  └── github.ts  →  poll via `gh api`                   │
│                                                        │
│  Core:                                                 │
│  ├── Scheduler     →  per-origin poll loop + backoff   │
│  ├── Cursor Store  →  persists position per origin     │
│  ├── Dedup         →  ring buffer, no re-delivery      │
│  └── Registry      →  who subscribed to what           │
│                                                        │
│  Sinks (output adapters):                              │
│  ├── stdout        →  JSON lines (pipe-friendly)       │
│  └── webhook       →  POST to any URL                  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Three boundaries, cleanly separated:**
- **Sources** know how to poll a specific platform. They don't know about subscribers or sinks.
- **Core** knows scheduling, state, dedup, and the subscription registry. It doesn't know about platforms.
- **Sinks** know how to deliver events. They don't know where events came from.

### Consumer-Side Subscription

The key design choice: **Channel doesn't decide where events go.** Instead, consumers (humans or agents) subscribe to the origins they care about.

This means:
- No routing logic in Channel. No dispatcher, no "smart" routing.
- Multi-to-multi is free: one consumer subscribes to many sources, one source has many consumers.
- Session lifecycle is not Channel's problem: if a consumer dies, delivery fails, Channel cleans up.

## Event Schema

Every event follows a unified envelope:

```json
{
  "id": "gh-comment-123456",
  "source": "github",
  "type": "issue_comment.created",
  "timestamp": "2026-03-24T17:30:00Z",
  "origin": "github:user/repo#42",
  "payload": {
    "author": "reviewer",
    "body": "This needs error handling",
    "htmlUrl": "https://github.com/user/repo/issues/42#issuecomment-123456"
  }
}
```

| Field | Description |
|-------|-------------|
| `id` | Globally unique event ID (used for dedup) |
| `source` | Which source adapter produced this event |
| `type` | Platform-specific event type (dot-namespaced) |
| `timestamp` | When the event occurred on the platform (ISO-8601) |
| `origin` | Origin identifier — what subscriptions match against |
| `payload` | Platform-specific event data |

## GitHub Source

The GitHub source adapter uses `gh api` for all API calls, inheriting your existing `gh` authentication, proxy settings, and host configuration.

### Origin Formats

| Origin | What it watches |
|--------|-----------------|
| `github:owner/repo` | All repo events (pushes, PRs, issues, stars, etc.) |
| `github:owner/repo#42` | Comments on issue/PR #42 |
| `github:owner/repo/pulls` | All pull request activity |
| `github:owner/repo/issues` | All issue activity |

### Event Types

| Event Type | Origin | Description |
|------------|--------|-------------|
| `issue_comment.created` | `#number` | New comment on an issue/PR |
| `pull_request.open` | `/pulls` | PR opened or updated |
| `pull_request.closed` | `/pulls` | PR closed |
| `issue.open` | `/issues` | Issue opened or updated |
| `issue.closed` | `/issues` | Issue closed |
| `push` | repo-level | Code pushed |
| `pull_request_review` | repo-level | PR review submitted |
| `release` | repo-level | New release published |
| `star` | repo-level | Repo starred |

### Examples

```bash
# Watch a specific issue for new comments
opencli channel subscribe github:jackwener/opencli#369
opencli channel start

# Watch all PRs in a repo
opencli channel subscribe github:myorg/myproject/pulls

# One-shot: grab recent events for an issue
opencli channel poll github:myorg/myproject#100

# Poll from a specific point in time
opencli channel poll github:myorg/myproject#100 --since 2026-03-01T00:00:00Z
```

## CLI Reference

### `opencli channel sources [name]`

List available event sources. With a source name, lists subscribable items.

```bash
opencli channel sources          # all sources
opencli channel sources github   # GitHub-specific items
```

### `opencli channel subscribe <origin>`

Subscribe to events from an origin.

```bash
opencli channel subscribe github:owner/repo#42
opencli channel subscribe github:owner/repo/pulls --sink webhook --webhook-url http://localhost:3000/events
opencli channel subscribe github:owner/repo --interval 120000  # 2 min interval
```

Options:
- `-s, --sink <name>` — Sink to deliver to (default: `stdout`)
- `-i, --interval <ms>` — Poll interval in ms (default: `60000`)
- `--webhook-url <url>` — URL for webhook sink

### `opencli channel unsubscribe <origin>`

Remove a subscription.

```bash
opencli channel unsubscribe github:owner/repo#42
```

### `opencli channel subscriptions`

List all current subscriptions.

```bash
opencli channel subscriptions
opencli channel subscriptions --format json
```

### `opencli channel start`

Start the polling daemon.

```bash
opencli channel start      # foreground (Ctrl+C to stop)
opencli channel start -d   # background daemon
```

### `opencli channel stop`

Stop the background daemon.

### `opencli channel status`

Show daemon status, subscription list, and cursor positions.

### `opencli channel poll <origin>`

One-shot poll: fetch events and print to stdout as JSON lines.

```bash
opencli channel poll github:owner/repo#42
opencli channel poll github:owner/repo#42 --since 2026-03-01T00:00:00Z
```

## Writing a Custom Source Adapter

A source adapter implements the `ChannelSource` interface:

```typescript
import type { ChannelSource, ChannelEvent, PollResult, SourcePollConfig, SubscribableItem } from '../types.js';

export class MySource implements ChannelSource {
  readonly name = 'mysource';

  async listSubscribable(config: Record<string, unknown>): Promise<SubscribableItem[]> {
    // Return items users can subscribe to
    return [
      { origin: 'mysource:channel/general', description: 'General channel' },
    ];
  }

  parseOrigin(origin: string): SourcePollConfig | null {
    // Parse "mysource:channel/general" → config object
    if (!origin.startsWith('mysource:')) return null;
    const channel = origin.slice('mysource:'.length);
    return { channel };
  }

  async poll(config: SourcePollConfig, cursor: string | null): Promise<PollResult> {
    // Fetch new events since cursor
    // Use CLI tools (not raw HTTP) when possible
    const events: ChannelEvent[] = [/* ... */];
    return { events, cursor: 'new-cursor-value' };
  }
}
```

Then register it in `src/channel/index.ts`:

```typescript
import { MySource } from './sources/mysource.js';

function getSources(): Map<string, ChannelSource> {
  const map = new Map();
  map.set('github', new GitHubSource());
  map.set('mysource', new MySource());  // ← add here
  return map;
}
```

## Writing a Custom Sink Adapter

A sink adapter implements the `ChannelSink` interface:

```typescript
import type { ChannelSink, ChannelEvent } from '../types.js';

export class MySink implements ChannelSink {
  readonly name = 'mysink';

  async init(config: Record<string, unknown>): Promise<void> {
    // Initialize with config from subscription
  }

  async deliver(events: ChannelEvent[]): Promise<void> {
    for (const event of events) {
      // Deliver each event
    }
  }
}
```

## Configuration Files

All state lives in `~/.opencli/channel/`:

| File | Purpose |
|------|---------|
| `subscriptions.json` | Subscription registry |
| `cursors.json` | Poll cursor positions per origin |
| `daemon.pid` | PID of running daemon |

These are plain JSON — human-readable and inspectable.

## Design Philosophy

Channel is a **pipe**, not a brain.

It borrows from Unix `fetchmail`: poll remote sources, track what you've seen, deliver to whoever asked. It doesn't decide what to do with events — that's the consumer's job.

The consumer-side subscription model means Channel stays thin:
1. **Deliver** — get the event to the right place
2. **Continuity** — same origin always goes to the same subscriber
3. **Isolation** — different subscriptions don't cross

Everything else — how to respond, whether to spawn new sessions, whether to write to a doc or reply in chat — is the consumer's decision.

## Related

- [RFC: OpenCLI Channel](https://github.com/jackwener/opencli/issues/369)
- [fetchmail](https://en.wikipedia.org/wiki/Fetchmail) — the Unix inspiration
