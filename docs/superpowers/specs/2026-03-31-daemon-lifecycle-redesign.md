# Daemon Lifecycle Redesign

## Problem

OpenCLI's daemon auto-exits after 5 minutes of idle time. During typical development
cycles (write code → test → modify → test again), coding intervals frequently exceed
5 minutes. Each restart incurs 2-4 seconds of overhead (process spawn + Extension
WebSocket reconnection), creating a noticeable and frustrating delay.

The current design treats the daemon as a disposable process, but the actual cost
profile doesn't justify this:

| Cost of staying alive | Cost of restarting |
|-----------------------|--------------------|
| ~12 MB memory, 0% CPU | 2-4 seconds delay per restart |

The restart cost far outweighs the idle cost.

## Solution

Replace the aggressive 5-minute fixed timeout with a long-lived daemon model. The
daemon stays running for hours, exits only when truly abandoned, and reconnects to
the Chrome Extension faster when needed.

Four changes:

1. Extend idle timeout from 5 minutes to 4 hours (configurable)
2. Require dual idle condition: both no CLI requests AND no Extension connection
3. Reduce Extension WebSocket reconnect backoff cap from 60s to 5s
4. Add `opencli daemon status/stop/restart` commands

## Design

### Timeout Strategy

**Current behavior:** A single idle timer resets on each HTTP request. After 5
minutes without a request, the daemon calls `process.exit(0)`.

**New behavior:** The daemon tracks two activity signals independently:

- **CLI activity:** timestamp of the last HTTP request from any CLI invocation
- **Extension activity:** whether a WebSocket connection from the Chrome Extension
  is currently open

The exit countdown starts only when BOTH conditions are met simultaneously:

- No CLI request for `IDLE_TIMEOUT` duration
- No Extension WebSocket connection

If either signal is active, the daemon stays alive. This means:

- A connected Extension keeps the daemon alive indefinitely (user has Chrome open,
  likely still working)
- Recent CLI activity keeps the daemon alive even if Extension temporarily
  disconnects (Chrome restarting, Extension updating)

**Timeout value:** 4 hours by default.

```typescript
const DEFAULT_IDLE_TIMEOUT = 4 * 60 * 60 * 1000; // 4 hours
const IDLE_TIMEOUT = DEFAULT_IDLE_TIMEOUT;
```

**Timer implementation:**

```
resetIdleTimer():
  clear existing timer
  if Extension is connected:
    do not start timer (Extension connection keeps daemon alive)
    return
  start timer with IDLE_TIMEOUT duration
  on timeout: process.exit(0)

On CLI HTTP request:
  update lastRequestTime
  resetIdleTimer()

On Extension WebSocket connect:
  clear timer (Extension keeps daemon alive)

On Extension WebSocket disconnect:
  elapsed = now - lastRequestTime
  if elapsed >= IDLE_TIMEOUT:
    process.exit(0)  // CLI has been idle long enough already
  else:
    start timer with (IDLE_TIMEOUT - elapsed)  // count remaining time
```

### Extension Fast Reconnect

**Current behavior:** When the Extension loses its WebSocket connection to the
daemon, it reconnects with exponential backoff: 2s → 4s → 8s → 16s → 32s → 60s
(capped). In the worst case, the Extension waits up to 60 seconds before attempting
reconnection.

**New behavior:** Cap the backoff at 5 seconds instead of 60 seconds.

```typescript
// extension/src/background.ts
const WS_RECONNECT_MAX_DELAY = 5000; // was 60000
```

Rationale: with a 4-hour daemon timeout, the daemon is almost always running. Long
backoff intervals are unnecessary and only increase reconnection latency. A 5-second
cap means the Extension reconnects within 5 seconds of the daemon becoming available.

### Daemon Management Commands

Add three new CLI commands for daemon lifecycle management:

**`opencli daemon status`**

Queries the daemon's `/status` endpoint (new) and displays:

```
Daemon: running (PID 12345)
Uptime: 2h 15m
Extension: connected
Last CLI request: 8 min ago
Memory: 12.3 MB
Port: 19825
```

If daemon is not running:

```
Daemon: not running
```

**`opencli daemon stop`**

Sends a `POST /shutdown` request to the daemon, which triggers a graceful shutdown:
reject pending requests with a shutdown message, close WebSocket connections, close
HTTP server, then exit.

**`opencli daemon restart`**

Equivalent to `stop` followed by spawning a new daemon. Useful when the daemon gets
into a bad state.

**Daemon-side endpoints:**

- `GET /status` — returns JSON with PID, uptime, extension connection state, last
  request time, memory usage
- `POST /shutdown` — initiates graceful shutdown

Both endpoints require the same `X-OpenCLI` header as existing endpoints for CSRF
protection.

### CLI Connection Experience

**Current behavior:** When daemon is running but Extension is not connected, the CLI
silently polls every 300ms and eventually times out with a generic error.

**New behavior:** Show a progress indicator and actionable message:

```
⏳ Waiting for Chrome extension to connect...
   Make sure Chrome is open and the OpenCLI extension is enabled.
```

Poll interval reduced from 300ms to 200ms for slightly faster detection.

If the daemon is not running at all (connection refused), the CLI spawns it as before
and shows:

```
⏳ Starting daemon...
```

## Files Changed

| File | Change | Estimated LOC |
|------|--------|---------------|
| `src/daemon.ts` | Dual-condition idle timeout, `/status` endpoint, `/shutdown` endpoint | ~40 |
| `extension/src/background.ts` | `WS_RECONNECT_MAX_DELAY` 60000 → 5000 | 1 |
| `src/browser/daemon-client.ts` | Better connection-waiting UX, 200ms poll interval | ~20 |
| `src/commands/daemon.ts` (new) | `status`, `stop`, `restart` subcommands | ~80 |
| `src/constants.ts` | `DEFAULT_IDLE_TIMEOUT` constant | 2 |

**Total: ~143 lines of new/changed code.**

## Backward Compatibility

- No breaking changes to CLI commands or Extension protocol
- Existing `OPENCLI_DAEMON_PORT` environment variable continues to work
- The only observable behavior change: daemon stays alive longer
- New `daemon` subcommands are additive

## Testing

- Unit test: idle timer starts only when both CLI and Extension are idle
- Unit test: idle timer is cleared when Extension connects
- Unit test: `/status` returns correct state
- Unit test: `/shutdown` triggers graceful exit
- Integration test: daemon survives 10+ minutes without CLI requests while Extension
  is connected
- Integration test: daemon exits after configured timeout when fully idle
- Integration test: `opencli daemon status/stop/restart` work correctly

## Out of Scope

- OS-level daemon management (launchd/systemd) — can be added later if needed
- Daemon auto-update mechanism
- Multi-daemon coordination
- Persistent daemon state across restarts
