import { describe, expect, it } from 'vitest';
import { SiteSlotScheduler, SlotAdmission, parseSlotPolicy, parseSlotSession, slotSessionName, type SlotPolicy, type SlotReply } from './site-slots.js';

const policy = { poolSize: 2, minIntervalMs: 0, maxIntervalMs: 0 };
const noPending = () => false;

describe('SiteSlotScheduler', () => {
  it('grants up to poolSize distinct slots, then queues FIFO', () => {
    const s = new SiteSlotScheduler({ ttlMs: 1000 });
    s.enqueue('k', { runId: 'a', policy, now: 0 });
    s.enqueue('k', { runId: 'b', policy, now: 0 });
    s.enqueue('k', { runId: 'c', policy, now: 0 });
    const grants = s.pump(0, noPending);
    expect(grants.map(g => [g.runId, g.slot])).toEqual([['a', 0], ['b', 1]]);
    expect(s.isWaiting('c')).toBe(true);

    s.release('a');
    expect(s.pump(1, noPending).map(g => [g.runId, g.slot])).toEqual([['c', 0]]);
  });

  it('re-acquire by the current holder returns its slot immediately (transport retry)', () => {
    const s = new SiteSlotScheduler({ ttlMs: 1000 });
    s.enqueue('k', { runId: 'a', policy, now: 0 });
    s.pump(0, noPending);
    s.enqueue('k', { runId: 'a', policy, now: 5 });
    expect(s.pump(5, noPending).map(g => [g.runId, g.slot])).toEqual([['a', 0]]);
  });

  it('dedupes a re-enqueued waiter by runId', () => {
    const s = new SiteSlotScheduler({ ttlMs: 1000 });
    const one = { poolSize: 1, minIntervalMs: 0, maxIntervalMs: 0 };
    s.enqueue('k', { runId: 'a', policy: one, now: 0 });
    s.pump(0, noPending);
    s.enqueue('k', { runId: 'b', policy: one, now: 0 });
    s.enqueue('k', { runId: 'b', policy: one, now: 1 });
    s.release('a');
    expect(s.pump(2, noPending).map(g => g.runId)).toEqual(['b']);
    expect(s.pump(3, noPending)).toEqual([]);
  });

  it('cancelled waiters never get a slot', () => {
    const s = new SiteSlotScheduler({ ttlMs: 1000 });
    const one = { poolSize: 1, minIntervalMs: 0, maxIntervalMs: 0 };
    s.enqueue('k', { runId: 'a', policy: one, now: 0 });
    s.pump(0, noPending);
    s.enqueue('k', { runId: 'b', policy: one, now: 0 });
    s.enqueue('k', { runId: 'c', policy: one, now: 0 });
    s.cancel('b');
    s.release('a');
    expect(s.pump(1, noPending).map(g => g.runId)).toEqual(['c']);
  });

  it('heartbeats keep a holder alive past the TTL; silence lets the slot expire', () => {
    const s = new SiteSlotScheduler({ ttlMs: 100 });
    const one = { poolSize: 1, minIntervalMs: 0, maxIntervalMs: 0 };
    s.enqueue('k', { runId: 'a', policy: one, now: 0 });
    s.pump(0, noPending);
    s.enqueue('k', { runId: 'b', policy: one, now: 0 });
    s.touch('a', 90);
    expect(s.pump(150, noPending)).toEqual([]);
    expect(s.pump(191, noPending).map(g => g.runId)).toEqual(['b']);
  });

  it('a TTL-stale holder with in-flight work is still alive', () => {
    const s = new SiteSlotScheduler({ ttlMs: 100 });
    const one = { poolSize: 1, minIntervalMs: 0, maxIntervalMs: 0 };
    s.enqueue('k', { runId: 'a', policy: one, now: 0 });
    s.pump(0, noPending);
    s.enqueue('k', { runId: 'b', policy: one, now: 0 });
    expect(s.pump(500, runId => runId === 'a')).toEqual([]);
  });

  it('spaces grants by the jittered interval and reports the next wake time', () => {
    const s = new SiteSlotScheduler({ ttlMs: 10_000, random: () => 0.5 });
    const paced = { poolSize: 3, minIntervalMs: 1000, maxIntervalMs: 2000 };
    s.enqueue('k', { runId: 'a', policy: paced, now: 0 });
    s.enqueue('k', { runId: 'b', policy: paced, now: 0 });
    expect(s.pump(0, noPending).map(g => g.runId)).toEqual(['a']);
    expect(s.nextWakeAt(0, noPending)).toBe(1500);
    expect(s.pump(1499, noPending)).toEqual([]);
    expect(s.pump(1500, noPending).map(g => g.runId)).toEqual(['b']);
  });

  it('keys are independent (per profile + site)', () => {
    const s = new SiteSlotScheduler({ ttlMs: 1000 });
    const one = { poolSize: 1, minIntervalMs: 0, maxIntervalMs: 0 };
    s.enqueue('p1', { runId: 'a', policy: one, now: 0 });
    s.enqueue('p2', { runId: 'b', policy: one, now: 0 });
    expect(s.pump(0, noPending).map(g => g.runId).sort()).toEqual(['a', 'b']);
  });
});

describe('slotSessionName', () => {
  it('derives a stable per-slot persistent session name', () => {
    expect(slotSessionName('xiaohongshu', 1)).toBe('site:xiaohongshu#1');
  });
});

function harness(opts: { routeDown?: () => boolean; random?: () => number; ttlMs?: number } = {}) {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  const pendingWork = new Set<string>();
  const logs: string[] = [];
  const scheduler = new SiteSlotScheduler({ ttlMs: opts.ttlMs ?? 1000, random: opts.random ?? (() => 0) });
  const admission = new SlotAdmission({
    scheduler,
    routeFailure: () => (opts.routeDown?.() ? { errorCode: 'profile_disconnected', error: 'gone' } : null),
    hasPendingWork: (runId) => pendingWork.has(runId),
    now: () => now,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (id) => { timers.delete(id as number); },
    log: (msg) => logs.push(msg),
  });
  const replies = new Map<string, SlotReply[]>();
  const acquire = (runId: string, policy: SlotPolicy, waitMs = 10_000) => admission.acquire({
    contextId: 'p1', site: 'xhs', runId, policy, waitMs,
    reply: (r) => { replies.set(runId, [...(replies.get(runId) ?? []), r]); },
  });
  const advance = (ms: number) => {
    const until = now + ms;
    // A wake timer that keeps re-arming at `now` would spin forever; fail instead.
    for (let fires = 0; ; fires++) {
      if (fires > 1000) throw new Error('timer storm: more than 1000 fires in one advance()');
      const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = until;
  };
  return { admission, scheduler, replies, acquire, advance, timers, logs, pendingWork };
}

const one: SlotPolicy = { poolSize: 1, minIntervalMs: 0, maxIntervalMs: 0 };

describe('SlotAdmission', () => {
  it('replies with the slot session on grant', () => {
    const h = harness();
    h.acquire('a', one);
    expect(h.replies.get('a')).toEqual([{ status: 200, body: { ok: true, data: { session: 'site:xhs#0', slot: 0, waitedMs: 0 } } }]);
  });

  it('rechecks the route at grant: a profile that dropped while queued gets 503 and the slot is not consumed', () => {
    let down = false;
    const h = harness({ routeDown: () => down });
    h.acquire('a', one);
    h.acquire('b', one);
    down = true;
    h.admission.release('a');
    expect(h.replies.get('b')).toEqual([{ status: 503, body: { ok: false, errorCode: 'profile_disconnected', error: 'gone' } }]);
    down = false;
    h.acquire('c', one);
    expect(h.replies.get('c')?.[0].status).toBe(200);
  });

  it('a client that goes away is dequeued and never granted', () => {
    const h = harness();
    h.acquire('a', one);
    const cancelB = h.acquire('b', one);
    h.acquire('c', one);
    cancelB();
    h.admission.release('a');
    expect(h.replies.get('b')).toBeUndefined();
    expect(h.replies.get('c')?.[0].body).toMatchObject({ ok: true, data: { slot: 0 } });
    expect(h.logs).toContain('[slots] b left the queue (client gone)');
  });

  it('times out a waiter with slot_wait_timeout and frees its queue position', () => {
    const h = harness();
    h.acquire('a', one);
    h.acquire('b', one, 500);
    h.acquire('c', one, 5000);
    h.advance(500);
    expect(h.replies.get('b')).toEqual([{ status: 503, body: { ok: false, errorCode: 'slot_wait_timeout', error: 'No xhs slot became free within 1s.' } }]);
    expect(h.scheduler.isWaiting('b')).toBe(false);
    h.admission.release('a');
    expect(h.replies.get('c')?.[0].status).toBe(200);
  });

  it('a transport retry of the same queued run supersedes the abandoned request', () => {
    const h = harness();
    h.acquire('a', one);
    h.acquire('b', one);
    h.acquire('b', one);
    expect(h.replies.get('b')).toEqual([{ status: 409, body: { ok: false, errorCode: 'slot_superseded', error: 'Superseded by a retry of the same run.' } }]);
    h.admission.release('a');
    expect(h.replies.get('b')?.[1].status).toBe(200);
  });

  it('a retry by the current holder gets its own slot back immediately', () => {
    const h = harness({ random: () => 0 });
    const paced: SlotPolicy = { poolSize: 2, minIntervalMs: 5000, maxIntervalMs: 5000 };
    h.acquire('a', paced);
    h.acquire('a', paced);
    expect(h.replies.get('a')?.map(r => r.status)).toEqual([200, 200]);
    expect((h.replies.get('a')?.[1].body as { data: { slot: number } }).data.slot).toBe(0);
  });

  it('the wake timer grants a paced waiter without any other event', () => {
    const h = harness({ random: () => 0.5, ttlMs: 10_000 });
    const paced: SlotPolicy = { poolSize: 2, minIntervalMs: 1000, maxIntervalMs: 3000 };
    h.acquire('a', paced);
    h.acquire('b', paced);
    expect(h.replies.get('b')).toBeUndefined();
    h.advance(1999);
    expect(h.replies.get('b')).toBeUndefined();
    h.advance(1);
    expect(h.replies.get('b')?.[0].body).toMatchObject({ ok: true, data: { slot: 1, waitedMs: 2000 } });
  });

  it('a silent holder expires after the TTL and its slot is granted to the next waiter', () => {
    const h = harness({ ttlMs: 1000 });
    h.acquire('a', one);
    h.acquire('b', one, 60_000);
    h.advance(1001);
    expect(h.replies.get('b')?.[0].status).toBe(200);
  });

  it('a holder with in-flight work keeps its slot past the TTL, then hands over once it settles stale', () => {
    const h = harness({ ttlMs: 1000 });
    h.acquire('a', one);
    h.pendingWork.add('a');
    h.acquire('b', one, 60_000);
    h.advance(5000);
    expect(h.replies.get('b')).toBeUndefined();
    h.pendingWork.delete('a');
    h.admission.onWorkSettled('a');
    expect(h.replies.get('b')).toBeUndefined();
    h.advance(1001);
    expect(h.replies.get('b')?.[0].status).toBe(200);
  });

  it('does not spin when an expired holder frees a slot but pacing still blocks the grant', () => {
    const h = harness({ random: () => 0, ttlMs: 1000 });
    const paced: SlotPolicy = { poolSize: 1, minIntervalMs: 3000, maxIntervalMs: 3000 };
    h.acquire('a', paced);
    h.acquire('b', paced, 60_000);
    h.advance(1500);
    // Only the pacing deadline and b's wait budget are armed, both in the future.
    expect([...h.timers.values()].map(t => t.at).sort((x, y) => x - y)).toEqual([3000, 60_000]);
    h.advance(1500);
    expect(h.replies.get('b')?.[0].status).toBe(200);
  });

  it('keeps no timers armed once nothing is waiting', () => {
    const h = harness();
    h.acquire('a', one);
    h.acquire('b', one);
    h.admission.release('a');
    h.admission.release('b');
    expect(h.timers.size).toBe(0);
  });
});

describe('SlotAdmission.admitCommand (slot ownership gate)', () => {
  it('lets the holder through and refreshes its slot', () => {
    const h = harness({ ttlMs: 1000 });
    h.acquire('a', one);
    h.acquire('b', one, 60_000);
    h.advance(900);
    expect(h.admission.admitCommand({ contextId: 'p1', session: 'site:xhs#0', runId: 'a' })).toBeNull();
    h.advance(900);
    expect(h.replies.get('b')).toBeUndefined();
  });

  it('rejects a run that lost its slot to TTL reclamation, so it cannot drive the new holder\'s tab', () => {
    const h = harness({ ttlMs: 1000 });
    h.acquire('a', one);
    h.acquire('b', one, 60_000);
    h.advance(1001);
    expect(h.replies.get('b')?.[0].status).toBe(200);
    expect(h.admission.admitCommand({ contextId: 'p1', session: 'site:xhs#0', runId: 'a' })).toMatchObject({
      status: 409,
      body: { ok: false, errorCode: 'session_busy' },
    });
    expect(h.admission.admitCommand({ contextId: 'p1', session: 'site:xhs#0', runId: 'b' })).toBeNull();
  });

  it('allows non-slot and idle manual sessions but rejects unowned runs', () => {
    const h = harness();
    h.acquire('a', one);
    expect(h.admission.admitCommand({ contextId: 'p1', session: 'site:xhs', runId: 'z' })).toBeNull();
    expect(h.admission.admitCommand({ contextId: 'p2', session: 'site:xhs#0', runId: 'z' })).toMatchObject({ status: 409 });
    expect(h.admission.admitCommand({ contextId: 'p1', session: 'site:xhs#0', runId: undefined })).toMatchObject({ status: 409 });
    h.admission.release('a');
    expect(h.admission.admitCommand({ contextId: 'p1', session: 'site:xhs#0', runId: undefined })).toBeNull();
  });
});

describe('parseSlotSession', () => {
  it('round-trips slot session names and rejects other sessions', () => {
    expect(parseSlotSession(slotSessionName('xiaohongshu', 3))).toEqual({ site: 'xiaohongshu', slot: 3 });
    expect(parseSlotSession('site:xiaohongshu')).toBeNull();
    expect(parseSlotSession('site:xiaohongshu:8c1f')).toBeNull();
    expect(parseSlotSession(undefined)).toBeNull();
  });
});

describe('parseSlotPolicy', () => {
  it('accepts a positive integer pool size and orders the interval', () => {
    expect(parseSlotPolicy({ poolSize: 2, minIntervalMs: 3000, maxIntervalMs: 1000 })).toEqual({ poolSize: 2, minIntervalMs: 3000, maxIntervalMs: 3000 });
    expect(parseSlotPolicy({ poolSize: 1 })).toEqual({ poolSize: 1, minIntervalMs: 0, maxIntervalMs: 0 });
  });

  it('rejects a missing, zero, fractional or negative pool size', () => {
    for (const poolSize of [undefined, 0, 1.5, -1, '2']) expect(parseSlotPolicy({ poolSize })).toBeNull();
  });
});


describe('slot admission boundaries', () => {
  it('rejects reuse of a queued run in another pool without corrupting its original waiter', () => {
    const h = harness();
    h.acquire('a', one);
    h.acquire('b', one);
    const replies: SlotReply[] = [];
    h.admission.acquire({ contextId: 'p2', site: 'other', runId: 'b', policy: one, waitMs: 1000, reply: r => replies.push(r) });
    expect(replies[0]).toMatchObject({ status: 409, body: { errorCode: 'slot_conflict' } });
    h.admission.release('a');
    expect(h.replies.get('b')).toHaveLength(1);
    expect(h.replies.get('b')?.[0]).toMatchObject({ status: 200, body: { data: { session: 'site:xhs#0' } } });
  });
  it('rejects reuse of a holder in another pool', () => {
    const h = harness();
    h.acquire('a', one);
    const replies: SlotReply[] = [];
    h.admission.acquire({ contextId: 'p2', site: 'other', runId: 'a', policy: one, waitMs: 1000, reply: r => replies.push(r) });
    expect(replies[0].status).toBe(409);
    expect(h.admission.admitCommand({ contextId: 'p1', session: 'site:xhs#0', runId: 'a' })).toBeNull();
  });
  it('does not let another caller expand an active pool or override its pacing', () => {
    const h = harness();
    h.acquire('a', one);
    h.acquire('b', { poolSize: 2, minIntervalMs: 0, maxIntervalMs: 0 });
    expect(h.replies.get('b')?.[0].status).toBe(409);
    expect(h.admission.list()).toHaveLength(1);
    h.admission.release('a');
    h.acquire('c', { poolSize: 2, minIntervalMs: 0, maxIntervalMs: 0 });
    expect(h.replies.get('c')?.[0].status).toBe(200);
  });
  it('does not let a released run drive an idle slot', () => {
    const h = harness();
    h.acquire('a', one);
    h.admission.release('a');
    expect(h.admission.admitCommand({ contextId: 'p1', session: 'site:xhs#0', runId: 'a' })).toMatchObject({ status: 409 });
  });
  it('drains all queued route failures without waiting for unrelated deadlines', () => {
    let down = false;
    const h = harness({ routeDown: () => down });
    h.acquire('a', one); h.acquire('b', one); h.acquire('c', one);
    down = true;
    h.admission.release('a');
    expect(h.replies.get('b')?.[0].status).toBe(503);
    expect(h.replies.get('c')?.[0].status).toBe(503);
    expect(h.timers.size).toBe(0);
  });
  it.each([NaN, Infinity, -1, 2_147_483_648])('rejects invalid wait budget %s without registering a waiter', waitMs => {
    const h = harness();
    h.acquire('a', one, waitMs);
    expect(h.replies.get('a')?.[0].status).toBe(409);
    expect(h.timers.size).toBe(0);
  });
  it('rejects unbounded pool allocation and invalid interval values', () => {
    expect(parseSlotPolicy({ poolSize: 1e12 })).toBeNull();
    for (const value of [Infinity, NaN, -1, '1', 2_147_483_648]) {
      expect(parseSlotPolicy({ poolSize: 1, minIntervalMs: value })).toBeNull();
      expect(parseSlotPolicy({ poolSize: 1, maxIntervalMs: value })).toBeNull();
    }
  });
});
