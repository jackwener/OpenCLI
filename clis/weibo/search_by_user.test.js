import { describe, it, expect } from 'vitest';

describe('search_by_user helpers', () => {
  // dateToTimestamp: YYYY-MM-DD -> Unix seconds at 00:00:00 Beijing time
  function dateToTimestamp(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const beijing = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    return Math.floor((beijing.getTime() - 8 * 3600 * 1000) / 1000);
  }

  describe('dateToTimestamp', () => {
    it('converts 2025-06-01 to correct UTC+8 timestamp', () => {
      const ts = dateToTimestamp('2025-06-01');
      expect(ts).toBe(1748707200);
    });

    it('converts 2025-01-01', () => {
      const ts = dateToTimestamp('2025-01-01');
      expect(ts).toBe(1735660800);
    });
  });
});
