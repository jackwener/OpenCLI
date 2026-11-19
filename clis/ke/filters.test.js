import { describe, expect, it } from 'vitest';
import {
  buildErshoufangFilterPath,
  ORIENTATION, FLOOR, AGE, DECORATION, ELEVATOR, FEATURES, USAGE, SORT,
} from './filters.js';

describe('buildErshoufangFilterPath', () => {
  it('returns empty string when nothing is active', () => {
    expect(buildErshoufangFilterPath({})).toBe('');
  });

  // ── Golden tests on confirmed anchors (de3 / l3 / p / co32) ──
  it('encodes rooms as l{n}', () => {
    expect(buildErshoufangFilterPath({ rooms: 3 })).toBe('l3');
  });
  it('rejects out-of-range or non-numeric rooms instead of emitting garbage', () => {
    expect(() => buildErshoufangFilterPath({ rooms: 0 })).toThrow(/rooms/);
    expect(() => buildErshoufangFilterPath({ rooms: 6 })).toThrow(/rooms/);
    expect(() => buildErshoufangFilterPath({ rooms: 'abc' })).toThrow(/rooms/);
  });
  it('encodes decoration=rough as de3', () => {
    expect(buildErshoufangFilterPath({ decoration: 'rough' })).toBe('de3');
  });
  it('encodes sort=newest as co32', () => {
    expect(buildErshoufangFilterPath({ sort: 'newest' })).toBe('co32');
  });
  it('keeps the existing price encoding p{min}t{max}', () => {
    expect(buildErshoufangFilterPath({ 'min-price': 100, 'max-price': 300 })).toBe('p100t300');
  });
  it('encodes area range as ba{min}ea{max}', () => {
    expect(buildErshoufangFilterPath({ 'min-area': 70, 'max-area': 120 })).toBe('ba70ea120');
  });
  it('keeps a literal 0 lower bound instead of dropping it', () => {
    expect(buildErshoufangFilterPath({ 'min-area': 0, 'max-area': 90 })).toBe('ba0ea90');
  });
  it('encodes a lower-bound-only area as ba{min}ea (live: 70平以上)', () => {
    expect(buildErshoufangFilterPath({ 'min-area': 70 })).toBe('ba70ea');
  });
  it('defaults min to 0 for an upper-bound-only area (live: ba0ea120 = 120平以下)', () => {
    // Beike ignores `baea120`; an explicit min is required.
    expect(buildErshoufangFilterPath({ 'max-area': 120 })).toBe('ba0ea120');
  });

  // ── Parametric tests: derive expected from the tables (robust to verified codes) ──
  it('maps each single-value enum through its own table', () => {
    expect(buildErshoufangFilterPath({ orientation: 'south' })).toBe(ORIENTATION.south);
    expect(buildErshoufangFilterPath({ floor: 'high' })).toBe(FLOOR.high);
    expect(buildErshoufangFilterPath({ age: '10' })).toBe(AGE['10']);
    expect(buildErshoufangFilterPath({ elevator: 'yes' })).toBe(ELEVATOR.yes);
    expect(buildErshoufangFilterPath({ usage: 'villa' })).toBe(USAGE.villa);
    expect(buildErshoufangFilterPath({ sort: 'total-price-asc' })).toBe(SORT['total-price-asc']);
  });

  it('splits --features and emits feature codes in table-definition order', () => {
    // input order reversed; output must follow FEATURES key order
    const expected = FEATURES['near-subway'] + FEATURES.vr;
    expect(buildErshoufangFilterPath({ features: 'vr,near-subway' })).toBe(expected);
  });
  it('throws ArgumentError on an unknown feature keyword', () => {
    expect(() => buildErshoufangFilterPath({ features: 'bogus' })).toThrow(/unknown/i);
  });
  it('trims and ignores blank feature entries', () => {
    expect(buildErshoufangFilterPath({ features: ' vr , ' })).toBe(FEATURES.vr);
  });

  // ── Canonical order across categories (uses only confirmed anchors) ──
  it('emits codes in canonical order regardless of kwargs key order', () => {
    const out = buildErshoufangFilterPath({ rooms: 3, decoration: 'rough', sort: 'newest' });
    expect(out).toBe('co32de3l3');
  });

  // Ground-truth URLs captured from the live site (Task 1).
  it('matches the verified live multi-filter URL (area before rooms)', () => {
    const out = buildErshoufangFilterPath({
      sort: 'newest', features: 'five-years', elevator: 'yes',
      'min-area': 79, 'max-area': 90, rooms: 3,
    });
    expect(out).toBe('co32mw1ie2ba79ea90l3');
  });
  it('matches the verified live URL for usage/decoration/age/floor/orientation', () => {
    const out = buildErshoufangFilterPath({
      usage: 'residential', decoration: 'fine', age: '5', floor: 'low', orientation: 'south',
    });
    expect(out).toBe('sf1de1y1lc1f2');
  });
});
