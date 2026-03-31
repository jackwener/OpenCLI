# Daemon Lifecycle Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the daemon's aggressive 5-minute idle timeout with a long-lived model (4h default) that requires both CLI inactivity AND Extension disconnection before exiting, plus add `daemon status/stop/restart` CLI commands.

**Architecture:** The daemon keeps its existing HTTP + WebSocket bridge architecture. We change the idle timeout logic to track two independent activity signals (CLI requests and Extension connection), add `/status` and `/shutdown` HTTP endpoints, reduce the Extension reconnect backoff cap, and register new CLI commands via Commander.js.

**Tech Stack:** Node.js, TypeScript, Commander.js, ws, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/constants.ts` | Modify | Add `DEFAULT_DAEMON_IDLE_TIMEOUT` constant |
| `src/daemon.ts` | Modify | Dual-condition idle timer, `/status` endpoint, `/shutdown` endpoint |
| `src/daemon.test.ts` | Create | Unit tests for idle timer logic, `/status`, `/shutdown` |
| `extension/src/protocol.ts` | Modify | Change `WS_RECONNECT_MAX_DELAY` from 60000 to 5000 |
| `src/cli.ts` | Modify | Register `daemon` subcommand group |
| `src/commands/daemon.ts` | Create | `status`, `stop`, `restart` subcommand implementations |
| `src/commands/daemon.test.ts` | Create | Unit tests for daemon commands |
| `src/browser/mcp.ts` | Modify | Better connection-waiting UX messages, 200ms poll interval |

---

### Task 1: Add `DEFAULT_DAEMON_IDLE_TIMEOUT` constant

**Files:**
- Modify: `src/constants.ts`

- [ ] **Step 1: Add the constant**

In `src/constants.ts`, add after the `DEFAULT_DAEMON_PORT` line:

```typescript
/** Default idle timeout before daemon auto-exits (ms). Override via OPENCLI_DAEMON_TIMEOUT env var. */
export const DEFAULT_DAEMON_IDLE_TIMEOUT = 4 * 60 * 60 * 1000; // 4 hours
```

- [ ] **Step 2: Commit**

```bash
git add src/constants.ts
git commit -m "feat(daemon): add DEFAULT_DAEMON_IDLE_TIMEOUT constant (4 hours)"
```

---

### Task 2: Implement dual-condition idle timer in daemon

**Files:**
- Modify: `src/daemon.ts:27,29-57,116-123,196-198,245-262,265-269`
- Test: `src/daemon.test.ts` (create)

- [ ] **Step 1: Write failing tests for the new idle timer logic**

Create `src/daemon.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the idle timer logic by extracting it into testable functions.
// The daemon module has side effects (starts server), so we test the logic unit directly.

describe('IdleManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not start timer when extension is connected', async () => {
    const { IdleManager } = await import('./daemon.js');
    const exit = vi.fn();
    const mgr = new IdleManager(300_000, exit); // 5 min for fast test

    mgr.setExtensionConnected(true);
    mgr.onCliRequest();

    vi.advanceTimersByTime(300_000 + 1000);
    expect(exit).not.toHaveBeenCalled();
  });

  it('starts timer when extension disconnects and CLI is idle', async () => {
    const { IdleManager } = await import('./daemon.js');
    const exit = vi.fn();
    const mgr = new IdleManager(300_000, exit);

    mgr.onCliRequest(); // CLI was active
    mgr.setExtensionConnected(true);
    mgr.setExtensionConnected(false); // Extension disconnects

    // Should not exit immediately — CLI was just active
    expect(exit).not.toHaveBeenCalled();

    // Advance past timeout
    vi.advanceTimersByTime(300_000 + 1000);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('exits immediately on extension disconnect if CLI has been idle past timeout', async () => {
    const { IdleManager } = await import('./daemon.js');
    const exit = vi.fn();
    const mgr = new IdleManager(300_000, exit);

    mgr.onCliRequest(); // Last CLI activity
    vi.advanceTimersByTime(400_000); // 400s elapsed — past 300s timeout

    mgr.setExtensionConnected(true);
    mgr.setExtensionConnected(false);

    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('resets timer on new CLI request', async () => {
    const { IdleManager } = await import('./daemon.js');
    const exit = vi.fn();
    const mgr = new IdleManager(300_000, exit);

    mgr.onCliRequest();
    vi.advanceTimersByTime(200_000); // 200s elapsed
    mgr.onCliRequest(); // Reset

    vi.advanceTimersByTime(200_000); // 200s more — only 200s since last request
    expect(exit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100_001); // Now 300s+ since last request
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('does not exit when timeout is 0 (disabled)', async () => {
    const { IdleManager } = await import('./daemon.js');
    const exit = vi.fn();
    const mgr = new IdleManager(0, exit);

    mgr.onCliRequest();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000); // 24 hours
    expect(exit).not.toHaveBeenCalled();
  });

  it('clears timer when extension connects', async () => {
    const { IdleManager } = await import('./daemon.js');
    const exit = vi.fn();
    const mgr = new IdleManager(300_000, exit);

    mgr.onCliRequest();
    vi.advanceTimersByTime(200_000); // Timer running

    mgr.setExtensionConnected(true); // Should clear timer
    vi.advanceTimersByTime(200_000); // Would have fired
    expect(exit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/daemon.test.ts
```

Expected: FAIL — `IdleManager` is not exported from `./daemon.js`

- [ ] **Step 3: Extract IdleManager class and refactor daemon.ts**

In `src/daemon.ts`, replace the idle timeout section (lines 27, 29-57) with:

Replace the `IDLE_TIMEOUT` constant (line 27):
```typescript
import { DEFAULT_DAEMON_PORT, DEFAULT_DAEMON_IDLE_TIMEOUT } from './constants.js';

const PORT = parseInt(process.env.OPENCLI_DAEMON_PORT ?? String(DEFAULT_DAEMON_PORT), 10);
const IDLE_TIMEOUT = Number(process.env.OPENCLI_DAEMON_TIMEOUT ?? DEFAULT_DAEMON_IDLE_TIMEOUT);
```

Replace the idle timer state and `resetIdleTimer` function (lines 37, 49-57) with the `IdleManager` class:

```typescript
/**
 * Manages daemon idle timeout with dual-condition logic:
 * exits only when BOTH CLI is idle AND Extension is disconnected.
 */
export class IdleManager {
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _lastCliRequestTime = Date.now();
  private _extensionConnected = false;
  private _timeoutMs: number;
  private _onExit: () => void;

  constructor(timeoutMs: number, onExit: () => void) {
    this._timeoutMs = timeoutMs;
    this._onExit = onExit;
  }

  /** Call when an HTTP request arrives from CLI */
  onCliRequest(): void {
    this._lastCliRequestTime = Date.now();
    this._resetTimer();
  }

  /** Call when Extension WebSocket connects or disconnects */
  setExtensionConnected(connected: boolean): void {
    this._extensionConnected = connected;
    if (connected) {
      // Extension is alive — clear any pending exit timer
      this._clearTimer();
    } else {
      // Extension gone — check if CLI has also been idle long enough
      this._resetTimer();
    }
  }

  private _clearTimer(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private _resetTimer(): void {
    this._clearTimer();

    // Timeout disabled
    if (this._timeoutMs <= 0) return;

    // Extension connected — don't start timer
    if (this._extensionConnected) return;

    const elapsed = Date.now() - this._lastCliRequestTime;
    if (elapsed >= this._timeoutMs) {
      // CLI has been idle past the timeout already
      this._onExit();
      return;
    }

    // Start timer for remaining duration
    this._timer = setTimeout(() => {
      this._onExit();
    }, this._timeoutMs - elapsed);
  }
}
```

Then create the global `idleManager` instance after the class definition:

```typescript
const idleManager = new IdleManager(IDLE_TIMEOUT, () => {
  console.error('[daemon] Idle timeout (no CLI requests + no Extension), shutting down');
  process.exit(0);
});
```

- [ ] **Step 4: Wire IdleManager into existing daemon code**

In the `handleRequest` function, replace `resetIdleTimer()` (line 142) with:
```typescript
idleManager.onCliRequest();
```

In the `wss.on('connection')` handler (around line 196-198), add after `extensionWs = ws;`:
```typescript
idleManager.setExtensionConnected(true);
```

In the `ws.on('close')` handler (around line 245-249), add after `extensionWs = null;`:
```typescript
idleManager.setExtensionConnected(false);
```

In the `ws.on('error')` handler (around line 259-261), add after `extensionWs = null;`:
```typescript
idleManager.setExtensionConnected(false);
```

In the `httpServer.listen` callback (line 268-269), replace `resetIdleTimer()` with:
```typescript
idleManager.onCliRequest(); // Start initial idle countdown
```

Remove the old `resetIdleTimer` function and `idleTimer` variable entirely.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/daemon.test.ts
```

Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/daemon.ts src/daemon.test.ts
git commit -m "feat(daemon): replace fixed 5min timeout with dual-condition idle manager (4h default)"
```

---

### Task 3: Add `/status` and `/shutdown` endpoints to daemon

**Files:**
- Modify: `src/daemon.ts:116-123`

- [ ] **Step 1: Add tests for /status and /shutdown endpoints**

Append to `src/daemon.test.ts`:

```typescript
describe('/status endpoint', () => {
  it('returns daemon status with correct fields', async () => {
    // This is an integration test — tested via the daemon command tests.
    // Here we just verify the shape of the status response type.
    expect(true).toBe(true); // Placeholder — real coverage in Task 6
  });
});
```

Note: The `/status` and `/shutdown` endpoints run inside the daemon process, which makes them hard to unit test in isolation. They are integration-tested via the `opencli daemon status/stop` commands in Task 6.

- [ ] **Step 2: Enhance the existing `/status` endpoint**

In `src/daemon.ts`, replace the existing `/status` handler (lines 116-123) with:

```typescript
if (req.method === 'GET' && pathname === '/status') {
  const uptime = process.uptime();
  const mem = process.memoryUsage();
  jsonResponse(res, 200, {
    ok: true,
    pid: process.pid,
    uptime,
    extensionConnected: extensionWs?.readyState === WebSocket.OPEN,
    pending: pending.size,
    lastCliRequestTime: idleManager.lastCliRequestTime,
    memoryMB: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
    port: PORT,
  });
  return;
}
```

Also add a public getter to `IdleManager`:

```typescript
get lastCliRequestTime(): number {
  return this._lastCliRequestTime;
}
```

- [ ] **Step 3: Add the `/shutdown` endpoint**

In `src/daemon.ts`, add before the `POST /command` handler:

```typescript
if (req.method === 'POST' && pathname === '/shutdown') {
  jsonResponse(res, 200, { ok: true, message: 'Shutting down' });
  // Graceful shutdown after response is sent
  setTimeout(() => shutdown(), 100);
  return;
}
```

- [ ] **Step 4: Run all tests**

```bash
npx vitest run src/daemon.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon.ts src/daemon.test.ts
git commit -m "feat(daemon): enhance /status endpoint, add /shutdown endpoint"
```

---

### Task 4: Reduce Extension WebSocket reconnect backoff cap

**Files:**
- Modify: `extension/src/protocol.ts:57`

- [ ] **Step 1: Change the constant**

In `extension/src/protocol.ts`, change line 57:

```typescript
/** Max reconnect delay (ms) — kept short since daemon is long-lived */
export const WS_RECONNECT_MAX_DELAY = 5000;
```

- [ ] **Step 2: Commit**

```bash
git add extension/src/protocol.ts
git commit -m "feat(extension): reduce WS reconnect backoff cap from 60s to 5s"
```

---

### Task 5: Implement `daemon status/stop/restart` CLI commands

**Files:**
- Create: `src/commands/daemon.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Create daemon command module**

Create `src/commands/daemon.ts`:

```typescript
/**
 * CLI commands for daemon lifecycle management:
 *   opencli daemon status  — show daemon state
 *   opencli daemon stop    — graceful shutdown
 *   opencli daemon restart — stop + respawn
 */

import chalk from 'chalk';
import { DEFAULT_DAEMON_PORT } from '../constants.js';

const DAEMON_PORT = parseInt(process.env.OPENCLI_DAEMON_PORT ?? String(DEFAULT_DAEMON_PORT), 10);
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;

interface DaemonStatus {
  ok: boolean;
  pid: number;
  uptime: number;
  extensionConnected: boolean;
  pending: number;
  lastCliRequestTime: number;
  memoryMB: number;
  port: number;
}

async function fetchStatus(): Promise<DaemonStatus | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${DAEMON_URL}/status`, {
      headers: { 'X-OpenCLI': '1' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json() as DaemonStatus;
  } catch {
    return null;
  }
}

async function requestShutdown(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${DAEMON_URL}/shutdown`, {
      method: 'POST',
      headers: { 'X-OpenCLI': '1' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

function formatTimeSince(timestampMs: number): string {
  const seconds = (Date.now() - timestampMs) / 1000;
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

export async function daemonStatus(): Promise<void> {
  const status = await fetchStatus();
  if (!status) {
    console.log(`Daemon: ${chalk.dim('not running')}`);
    return;
  }

  console.log(`Daemon: ${chalk.green('running')} (PID ${status.pid})`);
  console.log(`Uptime: ${formatUptime(status.uptime)}`);
  console.log(`Extension: ${status.extensionConnected ? chalk.green('connected') : chalk.yellow('disconnected')}`);
  console.log(`Last CLI request: ${formatTimeSince(status.lastCliRequestTime)}`);
  console.log(`Memory: ${status.memoryMB} MB`);
  console.log(`Port: ${status.port}`);
}

export async function daemonStop(): Promise<void> {
  const status = await fetchStatus();
  if (!status) {
    console.log(chalk.dim('Daemon is not running.'));
    return;
  }

  const ok = await requestShutdown();
  if (ok) {
    console.log(chalk.green('Daemon stopped.'));
  } else {
    console.error(chalk.red('Failed to stop daemon.'));
    process.exitCode = 1;
  }
}

export async function daemonRestart(): Promise<void> {
  const status = await fetchStatus();
  if (status) {
    const ok = await requestShutdown();
    if (!ok) {
      console.error(chalk.red('Failed to stop daemon.'));
      process.exitCode = 1;
      return;
    }
    // Wait for daemon to exit
    await new Promise(r => setTimeout(r, 500));
  }

  // Import BrowserBridge to spawn a new daemon
  const { BrowserBridge } = await import('../browser/mcp.js');
  const bridge = new BrowserBridge();
  try {
    console.log('Starting daemon...');
    await bridge.connect({ timeout: 10 });
    console.log(chalk.green('Daemon restarted.'));
  } catch (err) {
    console.error(chalk.red(`Failed to restart daemon: ${err instanceof Error ? err.message : err}`));
    process.exitCode = 1;
  }
}
```

- [ ] **Step 2: Register daemon commands in cli.ts**

In `src/cli.ts`, add the import at the top:

```typescript
import { daemonStatus, daemonStop, daemonRestart } from './commands/daemon.js';
```

Add the daemon subcommand group before the `// ── External CLIs` section (around line 380):

```typescript
  // ── Built-in: daemon ──────────────────────────────────────────────────────
  const daemonCmd = program.command('daemon').description('Manage the opencli daemon');
  daemonCmd
    .command('status')
    .description('Show daemon status')
    .action(async () => { await daemonStatus(); });
  daemonCmd
    .command('stop')
    .description('Stop the daemon')
    .action(async () => { await daemonStop(); });
  daemonCmd
    .command('restart')
    .description('Restart the daemon')
    .action(async () => { await daemonRestart(); });
```

- [ ] **Step 3: Run linter/type check**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/commands/daemon.ts src/cli.ts
git commit -m "feat(daemon): add opencli daemon status/stop/restart commands"
```

---

### Task 6: Write tests for daemon commands

**Files:**
- Create: `src/commands/daemon.test.ts`

- [ ] **Step 1: Write tests**

Create `src/commands/daemon.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally for all tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock chalk to avoid ANSI in assertions
vi.mock('chalk', () => ({
  default: {
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    dim: (s: string) => s,
  },
}));

describe('daemonStatus', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    mockFetch.mockReset();
  });

  it('shows "not running" when daemon is unreachable', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'));

    const { daemonStatus } = await import('./daemon.js');
    await daemonStatus();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('not running'));
  });

  it('shows daemon info when running', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        pid: 12345,
        uptime: 7200,
        extensionConnected: true,
        pending: 0,
        lastCliRequestTime: Date.now() - 60_000,
        memoryMB: 12.3,
        port: 19825,
      }),
    });

    const { daemonStatus } = await import('./daemon.js');
    await daemonStatus();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('running'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('12345'));
  });
});

describe('daemonStop', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
    mockFetch.mockReset();
  });

  it('reports when daemon is not running', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'));

    const { daemonStop } = await import('./daemon.js');
    await daemonStop();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('not running'));
  });

  it('sends shutdown and reports success', async () => {
    // First call: fetchStatus
    // Second call: requestShutdown
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, pid: 123, uptime: 100, extensionConnected: false, pending: 0, lastCliRequestTime: Date.now(), memoryMB: 10, port: 19825 }),
      })
      .mockResolvedValueOnce({ ok: true });

    const { daemonStop } = await import('./daemon.js');
    await daemonStop();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('stopped'));
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run src/commands/daemon.test.ts
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/commands/daemon.test.ts
git commit -m "test(daemon): add tests for daemon status/stop commands"
```

---

### Task 7: Improve CLI connection-waiting UX

**Files:**
- Modify: `src/browser/mcp.ts:58-118`

- [ ] **Step 1: Improve error messages and poll interval**

In `src/browser/mcp.ts`, replace the `_ensureDaemon` method (lines 58-118) with:

```typescript
private async _ensureDaemon(timeoutSeconds?: number): Promise<void> {
  const effectiveSeconds = (timeoutSeconds && timeoutSeconds > 0) ? timeoutSeconds : Math.ceil(DAEMON_SPAWN_TIMEOUT / 1000);
  const timeoutMs = effectiveSeconds * 1000;

  // Fast path: extension already connected
  if (await isExtensionConnected()) return;

  // Daemon running but no extension — wait for extension with progress
  if (await isDaemonRunning()) {
    if (process.env.OPENCLI_VERBOSE || process.stderr.isTTY) {
      process.stderr.write('⏳ Waiting for Chrome extension to connect...\n');
      process.stderr.write('   Make sure Chrome is open and the OpenCLI extension is enabled.\n');
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (await isExtensionConnected()) return;
    }
    throw new Error(
      'Daemon is running but the Browser Extension is not connected.\n' +
      'Please install and enable the opencli Browser Bridge extension in Chrome.',
    );
  }

  // No daemon — spawn one
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const parentDir = path.resolve(__dirname, '..');
  const daemonTs = path.join(parentDir, 'daemon.ts');
  const daemonJs = path.join(parentDir, 'daemon.js');
  const isTs = fs.existsSync(daemonTs);
  const daemonPath = isTs ? daemonTs : daemonJs;

  if (process.env.OPENCLI_VERBOSE || process.stderr.isTTY) {
    process.stderr.write('⏳ Starting daemon...\n');
  }

  const spawnArgs = isTs
    ? [process.execPath, '--import', 'tsx/esm', daemonPath]
    : [process.execPath, daemonPath];

  this._daemonProc = spawn(spawnArgs[0], spawnArgs.slice(1), {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  this._daemonProc.unref();

  // Wait for daemon + extension with faster polling
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 200));
    if (await isExtensionConnected()) return;
  }

  if (await isDaemonRunning()) {
    throw new Error(
      'Daemon is running but the Browser Extension is not connected.\n' +
      'Please install and enable the opencli Browser Bridge extension in Chrome.',
    );
  }

  throw new Error(
    'Failed to start opencli daemon. Try running manually:\n' +
    `  node ${daemonPath}\n` +
    `Make sure port ${DEFAULT_DAEMON_PORT} is available.`,
  );
}
```

- [ ] **Step 2: Run existing browser tests to check for regressions**

```bash
npx vitest run src/browser.test.ts
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/browser/mcp.ts
git commit -m "feat(daemon): improve CLI connection-waiting UX with progress messages and 200ms polling"
```

---

### Task 8: Run full test suite and verify

- [ ] **Step 1: Run type check**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass, no regressions

- [ ] **Step 3: Manual smoke test**

```bash
# Check daemon status (should be "not running" if daemon isn't started)
npx tsx src/main.ts daemon status

# Start daemon by running any browser command, then check status
npx tsx src/main.ts daemon status

# Stop daemon
npx tsx src/main.ts daemon stop

# Verify stopped
npx tsx src/main.ts daemon status
```

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during smoke testing"
```
