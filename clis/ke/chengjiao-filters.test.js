import { describe, expect, it } from 'vitest';
import {
  buildChengjiaoFilterPath,
  ORIENTATION, FLOOR, AGE, DECORATION, ELEVATOR, USAGE, SORT,
} from './chengjiao-filters.js';

// Anchors confirmed live on sh.ke.com/chengjiao (Task 1) via URL → document.title:
// l3→三室, sf1→普通住宅, de3→毛坯房, lc1→低楼层. Remaining codes match ershoufang's
// already-verified values (same domain + scheme); order is prefix-parsed (order-independent).
describe('buildChengjiaoFilterPath — confirmed live anchors', () => {
  it('rooms 3 -> l3 (三室)', () => {
    expect(buildChengjiaoFilterPath({ rooms: 3 })).toBe('l3');
  });
  it('usage residential -> sf1 (普通住宅)', () => {
    expect(buildChengjiaoFilterPath({ usage: 'residential' })).toBe('sf1');
  });
  it('decoration rough -> de3 (毛坯房)', () => {
    expect(buildChengjiaoFilterPath({ decoration: 'rough' })).toBe('de3');
  });
  it('floor low -> lc1 (低楼层)', () => {
    expect(buildChengjiaoFilterPath({ floor: 'low' })).toBe('lc1');
  });
});

describe('buildChengjiaoFilterPath — behavior', () => {
  it('returns empty string when nothing is active', () => {
    expect(buildChengjiaoFilterPath({})).toBe('');
  });
  it('maps each single-value enum through its own table', () => {
    expect(buildChengjiaoFilterPath({ orientation: 'south' })).toBe(ORIENTATION.south);
    expect(buildChengjiaoFilterPath({ floor: 'high' })).toBe(FLOOR.high);
    expect(buildChengjiaoFilterPath({ age: '10' })).toBe(AGE['10']);
    expect(buildChengjiaoFilterPath({ decoration: 'fine' })).toBe(DECORATION.fine);
    expect(buildChengjiaoFilterPath({ elevator: 'yes' })).toBe(ELEVATOR.yes);
    expect(buildChengjiaoFilterPath({ usage: 'villa' })).toBe(USAGE.villa);
    expect(buildChengjiaoFilterPath({ sort: 'total-price-asc' })).toBe(SORT['total-price-asc']);
  });
  it('rejects out-of-range or non-numeric rooms instead of emitting garbage', () => {
    expect(() => buildChengjiaoFilterPath({ rooms: 0 })).toThrow(/rooms/);
    expect(() => buildChengjiaoFilterPath({ rooms: 6 })).toThrow(/rooms/);
    expect(() => buildChengjiaoFilterPath({ rooms: 'abc' })).toThrow(/rooms/);
  });
  it('encodes a two-sided area range', () => {
    expect(buildChengjiaoFilterPath({ 'min-area': 70, 'max-area': 90 })).toBe('ba70ea90');
  });
  it('encodes a lower-bound-only area as ba{min}ea', () => {
    expect(buildChengjiaoFilterPath({ 'min-area': 70 })).toBe('ba70ea');
  });
  it('defaults min to 0 for an upper-bound-only area', () => {
    expect(buildChengjiaoFilterPath({ 'max-area': 90 })).toBe('ba0ea90');
  });
  it('emits codes in canonical order regardless of kwargs key order', () => {
    const a = buildChengjiaoFilterPath({ rooms: 3, decoration: 'rough', sort: 'total-price-asc' });
    const b = buildChengjiaoFilterPath({ sort: 'total-price-asc', decoration: 'rough', rooms: 3 });
    expect(a).toBe(b);
    expect(a).toBe('co21de3l3');
  });
});
