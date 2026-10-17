/**
 * Per-(contextId, site) slot pool with an admission queue.
 *
 * A pooled site owns N persistent sessions (`site:<site>#0..N-1`). The
 * extension already maps one session to exactly one tab, so a pool of sessions
 * is a pool of warm tabs with no extension change. A command run borrows one
 * slot exclusively for its whole duration (reads included), then returns it.
 *
 * Admission is where pacing lives: a grant happens only when a slot is free
 * AND the site's jittered interval since the previous grant has elapsed. The
 * unit is a command RUN, so commands that only evaluate against a warm tab are
 * paced too. Waiting happens in a registered queue (cancellable), never as a
 * bare sleep in the transport.
 *
 * `SiteSlotScheduler` is pure state (no timers, no I/O). `SlotAdmission` wraps
 * it with the request lifecycle — waiter replies, wait budgets, client-gone
 * cancellation, the post-wait route recheck, and one wake timer — behind
 * injected dependencies so the daemon stays a thin adapter.
 */

export interface SlotPolicy {
  poolSize: number;
  minIntervalMs: number;
  maxIntervalMs: number;
}

export interface SlotGrant {
  key: string;
  runId: string;
  slot: number;
}

interface Holder {
  runId: string;
  lastSeenAt: number;
}

interface Pool {
  policy: SlotPolicy;
  slots: Array<Holder | null>;
  queue: string[];
  nextGrantAt: number;
}

export function slotSessionName(site: string, slot: number): string {
  return `site:${site}#${slot}`;
}

export function slotPoolKey(contextId: string, site: string): string {
  return `${contextId}␟${site}`;
}

/** Inverse of `slotSessionName`; null for any non-slot session. */
export function parseSlotSession(session: unknown): { site: string; slot: number } | null {
  if (typeof session !== 'string') return null;
  const match = /^site:(.+)#(\d+)$/.exec(session);
  return match ? { site: match[1], slot: Number(match[2]) } : null;
}

/** Queue wait budget when the caller does not send one. */
export const SLOT_WAIT_DEFAULT_MS = 60_000;
export const MAX_SITE_SLOTS = 32;
export const MAX_SLOT_DELAY_MS = 2_147_483_647;

export function validSlotWaitMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_SLOT_DELAY_MS;
}

export class SiteSlotScheduler {
  private readonly pools = new Map<string, Pool>();
  /** runId → pool key, for every run that is queued or holding a slot. */
  private readonly runKeys = new Map<string, string>();
  /** Holders re-acquiring their own slot (transport retry) — answered on next pump. */
  private readonly reacquired = new Set<string>();
  private readonly ttlMs: number;
  private readonly random: () => number;

  constructor(opts: { ttlMs: number; random?: () => number }) {
    this.ttlMs = opts.ttlMs;
    this.random = opts.random ?? Math.random;
  }

  enqueue(key: string, input: { runId: string; policy: SlotPolicy; now: number }, hasPendingWork: (runId: string) => boolean = () => false): string | null {
    if (!parseSlotPolicy({ ...input.policy })) return 'Invalid slot policy.';
    const existingKey = this.runKeys.get(input.runId);
    if (existingKey !== undefined && existingKey !== key) return 'A run cannot acquire slots in different pools.';
    let pool = this.pools.get(key);
    if (!pool) {
      pool = { policy: input.policy, slots: [], queue: [], nextGrantAt: 0 };
      this.pools.set(key, pool);
    }
    if (pool.policy.poolSize !== input.policy.poolSize || pool.policy.minIntervalMs !== input.policy.minIntervalMs || pool.policy.maxIntervalMs !== input.policy.maxIntervalMs) {
      if (pool.queue.length || pool.slots.some(h => this.isAlive(h, input.now, hasPendingWork))) {
        return 'Slot policy cannot change while the pool has active runs or waiters.';
      }
      for (const holder of pool.slots) if (holder) this.runKeys.delete(holder.runId);
      pool.slots = [];
      pool.policy = input.policy;
    }
    while (pool.slots.length < input.policy.poolSize) pool.slots.push(null);
    const held = this.holderOf(input.runId);
    if (held) {
      held.lastSeenAt = input.now;
      this.reacquired.add(input.runId);
      return null;
    }
    if (this.runKeys.get(input.runId) === key) return null;
    this.runKeys.set(input.runId, key);
    pool.queue.push(input.runId);
    return null;
  }

  isWaiting(runId: string): boolean {
    const key = this.runKeys.get(runId);
    return key !== undefined && this.pools.get(key)!.queue.includes(runId);
  }

  hasWork(): boolean {
    if (this.reacquired.size > 0) return true;
    for (const pool of this.pools.values()) if (pool.queue.length > 0) return true;
    return false;
  }

  cancel(runId: string): void {
    const key = this.runKeys.get(runId);
    if (key === undefined) return;
    const pool = this.pools.get(key)!;
    const i = pool.queue.indexOf(runId);
    if (i < 0) return;
    pool.queue.splice(i, 1);
    this.runKeys.delete(runId);
  }

  touch(runId: string, now: number): void {
    const held = this.holderOf(runId);
    if (held) held.lastSeenAt = now;
  }

  release(runId: string): void {
    this.reacquired.delete(runId);
    const key = this.runKeys.get(runId);
    if (key === undefined) return;
    const pool = this.pools.get(key)!;
    const slot = pool.slots.findIndex(h => h?.runId === runId);
    if (slot < 0) {
      this.cancel(runId);
      return;
    }
    pool.slots[slot] = null;
    this.runKeys.delete(runId);
  }

  pump(now: number, hasPendingWork: (runId: string) => boolean): SlotGrant[] {
    const grants: SlotGrant[] = [];
    for (const runId of this.reacquired) {
      const key = this.runKeys.get(runId);
      const slot = key === undefined ? -1 : this.pools.get(key)!.slots.findIndex(h => h?.runId === runId);
      if (key !== undefined && slot >= 0) grants.push({ key, runId, slot });
    }
    this.reacquired.clear();
    for (const [key, pool] of this.pools) {
      while (pool.queue.length > 0 && now >= pool.nextGrantAt) {
        const slot = pool.slots.findIndex((h, i) => i < pool.policy.poolSize && !this.isAlive(h, now, hasPendingWork));
        if (slot < 0) break;
        const evicted = pool.slots[slot];
        if (evicted) this.runKeys.delete(evicted.runId);
        const runId = pool.queue.shift()!;
        pool.slots[slot] = { runId, lastSeenAt: now };
        const { minIntervalMs, maxIntervalMs } = pool.policy;
        pool.nextGrantAt = now + minIntervalMs + this.random() * Math.max(0, maxIntervalMs - minIntervalMs);
        grants.push({ key, runId, slot });
      }
    }
    return grants;
  }

  /** Earliest time a waiting run could be granted without any other event. */
  nextWakeAt(now: number, hasPendingWork: (runId: string) => boolean): number | null {
    let wake: number | null = null;
    const consider = (t: number) => { wake = wake === null ? t : Math.min(wake, t); };
    for (const pool of this.pools.values()) {
      if (pool.queue.length === 0) continue;
      if (pool.nextGrantAt > now) consider(pool.nextGrantAt);
      // Only future expiries matter: an already-expired holder is free now, so
      // if nothing was granted it is the pacing interval (above) that blocks.
      for (const h of pool.slots) {
        const expiresAt = h ? h.lastSeenAt + this.ttlMs + 1 : 0;
        if (h && expiresAt > now && !hasPendingWork(h.runId)) consider(expiresAt);
      }
    }
    return wake;
  }

  list(now: number, hasPendingWork: (runId: string) => boolean): Array<{ key: string; slot: number; runId: string | null; waiting: number }> {
    const out: Array<{ key: string; slot: number; runId: string | null; waiting: number }> = [];
    for (const [key, pool] of this.pools) {
      pool.slots.forEach((h, slot) => {
        if (slot >= pool.policy.poolSize) return;
        out.push({ key, slot, runId: this.isAlive(h, now, hasPendingWork) ? h!.runId : null, waiting: pool.queue.length });
      });
    }
    return out;
  }

  /** Live holder of one slot, if any. */
  holderAt(key: string, slot: number, now: number, hasPendingWork: (runId: string) => boolean): string | null {
    const h = this.pools.get(key)?.slots[slot] ?? null;
    return this.isAlive(h, now, hasPendingWork) ? h!.runId : null;
  }

  private holderOf(runId: string): Holder | undefined {
    const key = this.runKeys.get(runId);
    if (key === undefined) return undefined;
    return this.pools.get(key)!.slots.find(h => h?.runId === runId) ?? undefined;
  }

  private isAlive(h: Holder | null, now: number, hasPendingWork: (runId: string) => boolean): boolean {
    return h !== null && (now - h.lastSeenAt <= this.ttlMs || hasPendingWork(h.runId));
  }
}

/** What a granted slot-acquire returns to the CLI. */
export interface SlotGrantData {
  session: string;
  slot: number;
  waitedMs: number;
}

export type SlotReply =
  | { status: 200; body: { ok: true; data: SlotGrantData } }
  | { status: 409 | 503; body: { ok: false; errorCode?: string; error?: string } };

export interface SlotAdmissionDeps {
  scheduler: SiteSlotScheduler;
  /** Re-resolve a profile route at grant time; null means it is still connected. */
  routeFailure: (contextId: string) => { errorCode?: string; error?: string } | null;
  hasPendingWork: (runId: string) => boolean;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  log?: (msg: string) => void;
}

interface Waiter {
  site: string;
  contextId: string;
  requestedAt: number;
  reply: (reply: SlotReply) => void;
  waitTimer: unknown;
}

export class SlotAdmission {
  private readonly waiters = new Map<string, Waiter>();
  private wakeTimer: unknown = null;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly deps: SlotAdmissionDeps) {
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /**
   * Queue `runId` for a slot. `reply` is called exactly once — on grant,
   * route failure, wait timeout, or supersession by a retry of the same run.
   * Returns a cancel function for when the client goes away before a reply.
   */
  acquire(input: {
    contextId: string;
    site: string;
    runId: string;
    policy: SlotPolicy;
    waitMs: number;
    reply: (reply: SlotReply) => void;
  }): () => void {
    const { runId } = input;
    if (!validSlotWaitMs(input.waitMs)) {
      input.reply({ status: 409, body: { ok: false, errorCode: 'slot_conflict', error: 'Invalid slot wait budget.' } });
      return () => {};
    }
    const conflict = this.deps.scheduler.enqueue(slotPoolKey(input.contextId, input.site), { runId, policy: input.policy, now: this.now() }, this.deps.hasPendingWork);
    if (conflict) {
      input.reply({ status: 409, body: { ok: false, errorCode: 'slot_conflict', error: conflict } });
      return () => {};
    }
    const previous = this.waiters.get(runId);
    if (previous) {
      this.clearTimer(previous.waitTimer);
      previous.reply({ status: 409, body: { ok: false, errorCode: 'slot_superseded', error: 'Superseded by a retry of the same run.' } });
    }
    const waiter: Waiter = {
      site: input.site,
      contextId: input.contextId,
      requestedAt: this.now(),
      reply: input.reply,
      waitTimer: this.setTimer(() => {
        if (this.waiters.get(runId) !== waiter) return;
        this.waiters.delete(runId);
        this.deps.scheduler.cancel(runId);
        waiter.reply({
          status: 503,
          body: { ok: false, errorCode: 'slot_wait_timeout', error: `No ${input.site} slot became free within ${Math.round(input.waitMs / 1000)}s.` },
        });
        this.pump();
      }, input.waitMs),
    };
    this.waiters.set(runId, waiter);
    this.pump();
    return () => {
      if (this.waiters.get(runId) !== waiter) return;
      this.waiters.delete(runId);
      this.clearTimer(waiter.waitTimer);
      this.deps.scheduler.cancel(runId);
      this.deps.log?.(`[slots] ${runId} left the queue (client gone)`);
      this.pump();
    };
  }

  /**
   * Gate every browser command against slot ownership. A command on a slot
   * session from a run that no longer holds it (it went silent past the TTL
   * and the slot was granted to another run) is rejected, so it can never
   * drive the new holder's tab. A holder's command refreshes its slot.
   * Manual access without a run identity is allowed only while the slot is idle.
   */
  admitCommand(input: { contextId: string; session: unknown; runId: unknown }): SlotReply | null {
    const parsed = parseSlotSession(input.session);
    if (!parsed) return null;
    const holder = this.deps.scheduler.holderAt(slotPoolKey(input.contextId, parsed.site), parsed.slot, this.now(), this.deps.hasPendingWork);
    if (typeof input.runId !== 'string' || !input.runId) {
      if (holder === null) return null;
    } else if (holder === input.runId) {
      this.deps.scheduler.touch(input.runId, this.now());
      return null;
    }
    return {
      status: 409,
      body: {
        ok: false,
        errorCode: 'session_busy',
        error: `Slot session "${input.session}" is not held by this run. Acquire a slot before sending commands.`,
      },
    };
  }

  list(): ReturnType<SiteSlotScheduler['list']> {
    return this.deps.scheduler.list(this.now(), this.deps.hasPendingWork);
  }

  release(runId: string): void {
    this.deps.scheduler.release(runId);
    this.pump();
  }

  /** A holder's in-flight command settled: its TTL-staleness may now count. */
  onWorkSettled(runId: string): void {
    this.deps.scheduler.touch(runId, this.now());
    if (this.deps.scheduler.hasWork()) this.pump();
  }

  pump(): void {
    const { scheduler, hasPendingWork } = this.deps;
    const now = this.now();
    // A failed route can free a just-granted slot. Drain the next eligible
    // waiter immediately instead of leaving it with no wake event.
    for (let grants = scheduler.pump(now, hasPendingWork); grants.length; grants = scheduler.pump(now, hasPendingWork)) {
      for (const grant of grants) {
        const waiter = this.waiters.get(grant.runId);
        if (!waiter) {
          // Granted to a run whose client already left — hand the slot straight back.
          scheduler.release(grant.runId);
          continue;
        }
        this.waiters.delete(grant.runId);
        this.clearTimer(waiter.waitTimer);
        // Post-wait recheck: the profile may have disconnected while queued.
        const failure = this.deps.routeFailure(waiter.contextId);
        if (failure) {
          scheduler.release(grant.runId);
          waiter.reply({ status: 503, body: { ok: false, ...failure } });
          continue;
        }
        const session = slotSessionName(waiter.site, grant.slot);
        const waitedMs = now - waiter.requestedAt;
        this.deps.log?.(`[slots] ${grant.runId} granted ${session} after ${waitedMs}ms`);
        waiter.reply({ status: 200, body: { ok: true, data: { session, slot: grant.slot, waitedMs } } });
      }
    }
    if (this.wakeTimer !== null) {
      this.clearTimer(this.wakeTimer);
      this.wakeTimer = null;
    }
    if (!scheduler.hasWork()) return;
    const wake = scheduler.nextWakeAt(now, hasPendingWork);
    if (wake !== null) this.wakeTimer = this.setTimer(() => { this.wakeTimer = null; this.pump(); }, Math.max(0, wake - now));
  }
}

export function parseSlotPolicy(body: Record<string, unknown>): SlotPolicy | null {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_SLOT_DELAY_MS ? v : null);
  const poolSize = num(body.poolSize);
  const min = body.minIntervalMs === undefined ? 0 : num(body.minIntervalMs);
  const max = body.maxIntervalMs === undefined ? min : num(body.maxIntervalMs);
  if (poolSize === null || poolSize < 1 || poolSize > MAX_SITE_SLOTS || !Number.isInteger(poolSize) || min === null || max === null) return null;
  return { poolSize, minIntervalMs: min, maxIntervalMs: Math.max(min, max) };
}
