import { describe, expect, it } from 'vitest';
import { buildXiaoquFilterPath, AGE, SORT } from './xiaoqu-filters.js';

// Ground-truth URL captured from sh.ke.com (Task 1) and confirmed to filter correctly:
// title "上海徐汇10年以内、均价从低到高、近地铁".
describe('buildXiaoquFilterPath — live golden URL', () => {
  it('matches a captured multi-filter URL (10年以内/均价升序/近地铁)', () => {
    expect(buildXiaoquFilterPath({
      age: '10', 'near-subway': true, sort: 'avg-price-asc',
    })).toBe('cro21y2su1');
  });
});

describe('buildXiaoquFilterPath — behavior', () => {
  it('returns empty string when nothing is active', () => {
    expect(buildXiaoquFilterPath({})).toBe('');
  });
  it('maps age and sort through their tables', () => {
    expect(buildXiaoquFilterPath({ age: '10' })).toBe(AGE['10']);
    expect(buildXiaoquFilterPath({ sort: 'avg-price-asc' })).toBe(SORT['avg-price-asc']);
    expect(buildXiaoquFilterPath({ sort: 'avg-price-desc' })).toBe(SORT['avg-price-desc']);
  });
  it('emits the near-subway code only when truthy', () => {
    expect(buildXiaoquFilterPath({ 'near-subway': true })).toBe('su1');
    expect(buildXiaoquFilterPath({ 'near-subway': false })).toBe('');
    expect(buildXiaoquFilterPath({})).toBe('');
  });
  it('encodes a two-sided avg-price range as bp{min}ep{max}', () => {
    expect(buildXiaoquFilterPath({ 'min-price': 3, 'max-price': 5 })).toBe('bp3ep5');
  });
  it('encodes a lower-bound-only avg-price as bp{min}ep (live: 3万以上)', () => {
    expect(buildXiaoquFilterPath({ 'min-price': 3 })).toBe('bp3ep');
  });
  it('defaults min to 0 for an upper-bound-only avg-price (live: bp0ep5 = 5万以下)', () => {
    expect(buildXiaoquFilterPath({ 'max-price': 5 })).toBe('bp0ep5');
  });
  it('keeps a literal 0 lower bound', () => {
    expect(buildXiaoquFilterPath({ 'min-price': 0, 'max-price': 5 })).toBe('bp0ep5');
  });
  it('emits codes in canonical order regardless of kwargs key order', () => {
    const a = buildXiaoquFilterPath({ age: '10', sort: 'avg-price-asc' });
    const b = buildXiaoquFilterPath({ sort: 'avg-price-asc', age: '10' });
    expect(a).toBe(b);
    expect(a).toBe('cro21y2');
  });
});
