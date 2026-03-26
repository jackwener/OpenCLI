import { describe, expect, it } from 'vitest';

import { buildHotListUrl, getShanghaiDate } from './hot.js';

describe('36kr/hot date routing', () => {
  it('formats dates in Asia/Shanghai instead of UTC', () => {
    const date = new Date('2026-03-25T18:30:00.000Z');
    expect(getShanghaiDate(date)).toBe('2026-03-26');
  });

  it('builds dated hot-list routes with Shanghai-local date', () => {
    const date = new Date('2026-03-25T18:30:00.000Z');
    expect(buildHotListUrl('renqi', date)).toBe('https://www.36kr.com/hot-list/renqi/2026-03-26/1');
  });

  it('keeps catalog on the static route', () => {
    expect(buildHotListUrl('catalog')).toBe('https://www.36kr.com/hot-list/catalog');
  });
});
