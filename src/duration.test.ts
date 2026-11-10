import { describe, expect, it } from 'vitest';
import { parseDurationMs } from './duration.js';

describe('relative duration options', () => {
  it.each([
    ['500ms', 500], ['30s', 30000], ['1.5s', 1500], ['2m', 120000],
    ['24h', 86400000], ['60000', 60000], ['0', 0], [' 2m ', 120000],
  ])('parses %s as %i milliseconds', (input, expected) => {
    expect(parseDurationMs(input, 'since')).toBe(expected);
  });

  it.each(['7d', '2w', '2026-11-05', '-1s', 'Infinity', '1e3', '999999999999999999999h'])('rejects %s', input => {
    expect(parseDurationMs(input, 'since')).toEqual({ error: expect.stringContaining('--since') });
  });

  it('keeps absent durations optional for browser time-window filters', () => {
    expect(parseDurationMs(undefined, 'until')).toBeNull();
    expect(parseDurationMs('', 'until')).toBeNull();
  });
});
