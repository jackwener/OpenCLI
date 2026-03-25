import { describe, expect, it } from 'vitest';
import { validateTiming, toUnixSeconds } from './timing.js';

describe('validateTiming', () => {
  const now = () => Math.floor(Date.now() / 1000);

  it('accepts a time 3 hours from now', () => {
    expect(() => validateTiming(now() + 3 * 3600)).not.toThrow();
  });

  it('rejects a time less than 2 hours from now', () => {
    expect(() => validateTiming(now() + 3600)).toThrow('至少 2 小时后');
  });

  it('rejects a time more than 14 days from now', () => {
    expect(() => validateTiming(now() + 15 * 86400)).toThrow('不能超过 14 天');
  });
});

describe('toUnixSeconds', () => {
  it('passes through a numeric unix timestamp', () => {
    expect(toUnixSeconds(1744070400)).toBe(1744070400);
  });

  it('parses ISO8601 string', () => {
    expect(toUnixSeconds('2026-04-08T12:00:00Z')).toBe(
      Math.floor(new Date('2026-04-08T12:00:00Z').getTime() / 1000)
    );
  });

  it('throws on invalid input', () => {
    expect(() => toUnixSeconds('not-a-date')).toThrow();
  });
});
