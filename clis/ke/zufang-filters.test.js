import { describe, expect, it } from 'vitest';
import {
  buildZufangFilterPath,
  RENT_TYPE, ORIENTATION, FEATURES, LEASE_TERM, FLOOR, ELEVATOR, SORT,
} from './zufang-filters.js';

// Ground-truth URLs captured from sh.zu.ke.com (Task 1) and confirmed to filter correctly.
describe('buildZufangFilterPath — live golden URLs', () => {
  it('matches captured multi-filter URL #1 (整租/两居/近地铁/低楼层)', () => {
    expect(buildZufangFilterPath({
      'rent-type': 'whole', rooms: 2, features: 'near-subway', floor: 'low',
    })).toBe('lc200500000003su1rt200600000001l1');
  });
  it('matches captured multi-filter URL #2 (朝南/月租/有电梯/最新上架)', () => {
    expect(buildZufangFilterPath({
      orientation: 'south', 'lease-term': 'monthly', elevator: 'yes', sort: 'newest',
    })).toBe('ie1rmp1rco11f100500000003');
  });
});

describe('buildZufangFilterPath — behavior', () => {
  it('returns empty string when nothing is active', () => {
    expect(buildZufangFilterPath({})).toBe('');
  });
  it('maps each single-value enum through its own table', () => {
    expect(buildZufangFilterPath({ 'rent-type': 'whole' })).toBe(RENT_TYPE.whole);
    expect(buildZufangFilterPath({ orientation: 'south' })).toBe(ORIENTATION.south);
    expect(buildZufangFilterPath({ 'lease-term': 'monthly' })).toBe(LEASE_TERM.monthly);
    expect(buildZufangFilterPath({ floor: 'low' })).toBe(FLOOR.low);
    expect(buildZufangFilterPath({ elevator: 'yes' })).toBe(ELEVATOR.yes);
    expect(buildZufangFilterPath({ sort: 'newest' })).toBe(SORT.newest);
  });
  it('encodes rooms as l(n-1): 一居=l0, 两居=l1', () => {
    expect(buildZufangFilterPath({ rooms: 1 })).toBe('l0');
    expect(buildZufangFilterPath({ rooms: 2 })).toBe('l1');
    expect(buildZufangFilterPath({ rooms: 4 })).toBe('l3');
  });
  it('rejects out-of-range or non-numeric rooms instead of emitting garbage', () => {
    expect(() => buildZufangFilterPath({ rooms: 0 })).toThrow(/rooms/);
    expect(() => buildZufangFilterPath({ rooms: 5 })).toThrow(/rooms/);
    expect(() => buildZufangFilterPath({ rooms: 'abc' })).toThrow(/rooms/);
  });
  it('keeps the existing rent encoding rp{min}t{max}', () => {
    expect(buildZufangFilterPath({ 'min-price': 2000, 'max-price': 8000 })).toBe('rp2000t8000');
  });
  it('splits --features and emits feature codes in table-definition order', () => {
    const expected = FEATURES['near-subway'] + FEATURES.fine;
    expect(buildZufangFilterPath({ features: 'fine,near-subway' })).toBe(expected);
  });
  it('throws on an unknown feature keyword', () => {
    expect(() => buildZufangFilterPath({ features: 'bogus' })).toThrow(/unknown/i);
  });
  it('emits codes in canonical order regardless of kwargs key order', () => {
    const a = buildZufangFilterPath({ rooms: 2, 'rent-type': 'whole', floor: 'low' });
    const b = buildZufangFilterPath({ floor: 'low', 'rent-type': 'whole', rooms: 2 });
    expect(a).toBe(b);
    expect(a).toBe('lc200500000003rt200600000001l1');
  });
});
