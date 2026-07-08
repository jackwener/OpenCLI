import { describe, expect, it } from 'vitest';
import { RingBuffer } from './ring-buffer.js';

describe('RingBuffer', () => {
  it('keeps items in event order and filters by time window', () => {
    let now = 10_000;
    const buffer = new RingBuffer<{ ts: number; value: string }>({ maxAgeMs: 5_000, now: () => now });
    buffer.push({ ts: 4_000, value: 'old' });
    buffer.push({ ts: 7_000, value: 'kept' });
    buffer.push({ ts: 9_000, value: 'new' });

    expect(buffer.values().map((item) => item.value)).toEqual(['kept', 'new']);
    expect(buffer.values({ since: 8_000 }).map((item) => item.value)).toEqual(['new']);
    now = 13_000;
    expect(buffer.values().map((item) => item.value)).toEqual(['new']);
  });

  it('caps by item count', () => {
    const buffer = new RingBuffer<{ ts: number; value: number }>({ maxItems: 2, maxAgeMs: 100_000, now: () => 10 });
    buffer.push({ ts: 1, value: 1 });
    buffer.push({ ts: 2, value: 2 });
    buffer.push({ ts: 3, value: 3 });
    expect(buffer.values().map((item) => item.value)).toEqual([2, 3]);
  });
});
