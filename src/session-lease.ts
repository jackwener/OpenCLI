/**
 * Per-(contextId, surface, session) write-command arbitration for the daemon.
 *
 * A long adapter write command (e.g. `chatgpt ask`, 10-20 min) is hundreds of
 * short 'exec' round-trips against ONE persistent site session. When an outer
 * agent times out and retries while the first process is still alive, both
 * processes drive the same Chrome tab, multiplying renderer load — there is no
 * arbitration at the exec level because two interleaved asks rarely have an
 * exec in flight at the same instant.
 *
 * This registry grants ONE logical write lease per (contextId, surface,
 * session) that spans the whole CLI command run. A second concurrent write
 * fails fast, and a lease whose holder died (kill -9, crash) self-expires
 * after TTL of inactivity so a retry succeeds within a bounded time. Each exec
 * that flows through refreshes the lease, and a holder whose single exec
 * outlives the TTL (e.g. a slow navigate) is still protected while that exec
 * is in flight (see `hasPendingWork`), so a live long-running holder keeps the
 * lease indefinitely.
 *
 * The daemon is the arbiter because it is the single local process that sees
 * every CLI client; keeping the logic here (pure, no I/O) makes it testable
 * without Chrome.
 */

/** Inactivity window after which a lease is considered abandoned. */
export const SESSION_LEASE_TTL_MS = 45_000;

/** Machine-readable error code for the fast-fail busy response. */
export const SESSION_BUSY_CODE = 'session_busy';

export interface SessionLeaseHolder {
  /** Stable per logical CLI command run (NOT the per-exec command id). */
  runId: string;
  /** Human command name, e.g. `chatgpt ask`. */
  command: string;
  /** CLI process pid recovered from the runId, for the "kill it" hint. */
  pid: number | null;
  /** When the current holder first acquired the lease. */
  startedAt: number;
  /** Last time an exec from the holder refreshed the lease (heartbeat). */
  lastSeenAt: number;
}

/**
 * Lease key = `${contextId}␟${surface}␟${encodeURIComponent(session)}`. The
 * Chrome profile (contextId) is part of the key because a persistent site
 * session name like `site:chatgpt` is only unique WITHIN a profile — the same
 * adapter running in two profiles drives two different browsers and must never
 * self-block. The unit separator (U+241F) cannot appear in a contextId or
 * surface value; the session segment matches the extension's own lease-key
 * encoding so both layers partition sessions the same way.
 */
export function getSessionLeaseKey(contextId: string, surface: string, session: string): string {
  return `${contextId}␟${surface}␟${encodeURIComponent(session)}`;
}

/** CLI runIds are `run_<pid>_<ts>_<rand>`; recover the pid for the busy hint. */
export function parsePidFromRunId(runId: string): number | null {
  const match = /^run_(\d+)_/.exec(runId);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export type SessionLeaseCommand = {
  surface?: unknown;
  siteSession?: unknown;
  access?: unknown;
  session?: unknown;
  runId?: unknown;
};

/**
 * A command is subject to lease arbitration only when it is an adapter write
 * against a persistent site session and carries the identity needed to own a
 * lease. Read commands, ephemeral sessions, and non-adapter surfaces are never
 * arbitrated — a user mid-ask must still be able to check state.
 */
export function isSessionLeaseCommand<T extends SessionLeaseCommand>(
  command: T,
): command is T & { surface: 'adapter'; siteSession: 'persistent'; access: 'write'; session: string; runId: string } {
  return (
    command.surface === 'adapter' &&
    command.siteSession === 'persistent' &&
    command.access === 'write' &&
    typeof command.session === 'string' && command.session.length > 0 &&
    typeof command.runId === 'string' && command.runId.length > 0
  );
}

export interface LeaseTouchResult {
  granted: boolean;
  holder: SessionLeaseHolder;
}

export class SessionLeaseRegistry {
  private readonly leases = new Map<string, SessionLeaseHolder>();

  constructor(private readonly ttlMs: number = SESSION_LEASE_TTL_MS) {}

  /**
   * Acquire or refresh the lease for `key`.
   *
   * - Free key, or the current holder's lease has gone stale (holder died
   *   without releasing): the caller takes it — `granted: true`.
   * - Same runId as the current holder: refresh (heartbeat) — `granted: true`.
   * - A different runId while the holder is still alive: `granted: false`, and
   *   `holder` describes who to wait for or kill.
   *
   * Liveness is TTL-based, but a TTL-stale holder with a command still in
   * flight is NOT dead — a single exec can legitimately outlast the TTL (e.g.
   * a slow navigate produces no heartbeat until it settles). `hasPendingWork`
   * lets the daemon report that, keeping the registry pure.
   */
  touch(
    key: string,
    input: { runId: string; command: string; now: number; hasPendingWork?: (runId: string) => boolean },
  ): LeaseTouchResult {
    const current = this.leases.get(key);
    const alive = current !== undefined && (
      input.now - current.lastSeenAt <= this.ttlMs || input.hasPendingWork?.(current.runId) === true
    );
    if (current !== undefined && alive && current.runId !== input.runId) {
      return { granted: false, holder: current };
    }
    const holder: SessionLeaseHolder = current !== undefined && current.runId === input.runId
      ? { ...current, command: input.command, lastSeenAt: input.now }
      : {
        runId: input.runId,
        command: input.command,
        pid: parsePidFromRunId(input.runId),
        startedAt: input.now,
        lastSeenAt: input.now,
      };
    this.leases.set(key, holder);
    return { granted: true, holder };
  }

  /**
   * Refresh the holder's liveness without acquiring: called when one of the
   * holder's in-flight commands settles, so the TTL clock restarts cleanly
   * after an exec that outlived it. A non-owner runId never resurrects or
   * steals a lease here.
   */
  heartbeat(key: string, runId: string, now: number): void {
    const current = this.leases.get(key);
    if (current !== undefined && current.runId === runId) current.lastSeenAt = now;
  }

  /**
   * Release every lease held by `runId` (idempotent). Keyless on purpose: the
   * release path must not depend on re-resolving the profile route — the
   * profile may have disconnected by the time the CLI releases — and runIds
   * are globally unique, so the runId alone identifies the lease.
   */
  releaseByRunId(runId: string): void {
    for (const [key, holder] of this.leases) {
      if (holder.runId === runId) this.leases.delete(key);
    }
  }

  /** Active (non-expired) holder for `key`, lazily evicting a stale one. */
  get(key: string, now: number): SessionLeaseHolder | undefined {
    const current = this.leases.get(key);
    if (current === undefined) return undefined;
    if (now - current.lastSeenAt > this.ttlMs) {
      this.leases.delete(key);
      return undefined;
    }
    return current;
  }

  /**
   * Snapshot of active holders for status surfaces (who owns each session).
   * Uses the same aliveness rule as `touch()`: a TTL-stale holder with a
   * command still in flight is alive, not dead, so `hasPendingWork` keeps it
   * listed. Without it, `/status` would show no holder while challengers are
   * still being rejected — misleading during a single long exec. Read-only:
   * never lazily evicts.
   */
  list(now: number, hasPendingWork?: (runId: string) => boolean): Array<{ key: string } & SessionLeaseHolder> {
    const out: Array<{ key: string } & SessionLeaseHolder> = [];
    for (const [key, holder] of this.leases) {
      const alive = now - holder.lastSeenAt <= this.ttlMs || hasPendingWork?.(holder.runId) === true;
      if (alive) out.push({ key, ...holder });
    }
    return out;
  }
}

export interface SessionBusyFailure {
  message: string;
  errorCode: string;
  errorHint: string;
  status: number;
}

/** Build the fast-fail response naming the holder, its pid, and hold time. */
export function buildSessionBusyFailure(
  session: string,
  holder: SessionLeaseHolder,
  now: number,
): SessionBusyFailure {
  const heldSeconds = Math.max(0, Math.round((now - holder.startedAt) / 1000));
  const who = holder.pid != null ? `${holder.command} (pid ${holder.pid})` : holder.command;
  const stop = holder.pid != null
    ? `Wait for it to finish, or stop it with \`kill ${holder.pid}\` if it is stuck.`
    : 'Wait for it to finish, or stop that process if it is stuck.';
  return {
    message: `Session "${session}" is busy: ${who} has been driving it for ${heldSeconds}s.`,
    errorCode: SESSION_BUSY_CODE,
    errorHint: `${stop} Read-only commands are not blocked.`,
    status: 409,
  };
}
