import { describe, it, expect } from 'vitest';
import { HumanDelay, PROFILES, jitterMs, resolveProfile } from './human-delay.js';

describe('HumanDelay', () => {
  it('none profile returns 0', () => {
    const delay = new HumanDelay('none');
    for (let i = 0; i < 20; i++) {
      expect(delay.next()).toBe(0);
    }
  });

  it('moderate profile stays within bounds', () => {
    const delay = new HumanDelay('moderate');
    const values: number[] = [];
    for (let i = 0; i < 100; i++) {
      values.push(delay.next());
    }
    // Separate normal delays from breaks (breaks are >= breakDurationMs[0])
    const breakMin = PROFILES.moderate.breakDurationMs[0];
    const nonBreaks = values.filter(v => v < breakMin);
    for (const v of nonBreaks) {
      expect(v).toBeGreaterThanOrEqual(PROFILES.moderate.minMs);
      expect(v).toBeLessThanOrEqual(PROFILES.moderate.maxMs);
    }
  });

  it('cautious profile produces breaks within interval range', () => {
    const delay = new HumanDelay('cautious');
    const values: number[] = [];
    // Run enough iterations to trigger at least one break (breakEveryMin=8)
    for (let i = 0; i < 50; i++) {
      values.push(delay.next());
    }
    const breaks = values.filter(
      v => v >= PROFILES.cautious.breakDurationMs[0]
    );
    expect(breaks.length).toBeGreaterThan(0);
    for (const b of breaks) {
      expect(b).toBeGreaterThanOrEqual(PROFILES.cautious.breakDurationMs[0]);
      expect(b).toBeLessThanOrEqual(PROFILES.cautious.breakDurationMs[1]);
    }
  });

  it('reset() restarts action counter', () => {
    const delay = new HumanDelay('cautious');
    for (let i = 0; i < 5; i++) delay.next();
    delay.reset();
    // After reset, next break should be at least breakEveryMin actions away
    const values: number[] = [];
    for (let i = 0; i < PROFILES.cautious.breakEveryMin - 1; i++) {
      values.push(delay.next());
    }
    // All should be normal delays (no breaks yet)
    const breaks = values.filter(v => v >= PROFILES.cautious.breakDurationMs[0]);
    expect(breaks.length).toBe(0);
  });

  it('distribution has reasonable variance (not uniform)', () => {
    const delay = new HumanDelay('moderate');
    const values: number[] = [];
    for (let i = 0; i < 200; i++) {
      values.push(delay.next());
    }
    const nonBreaks = values.filter(v => v < PROFILES.moderate.breakDurationMs[0]);
    const mean = nonBreaks.reduce((a, b) => a + b, 0) / nonBreaks.length;
    const variance = nonBreaks.reduce((a, b) => a + (b - mean) ** 2, 0) / nonBreaks.length;
    const stddev = Math.sqrt(variance);
    // Log-normal should have meaningful spread — stddev > 10% of mean
    expect(stddev / mean).toBeGreaterThan(0.1);
  });
});

describe('jitterMs', () => {
  it('returns 0 for none profile', () => {
    expect(jitterMs('none')).toBe(0);
  });

  it('returns value within profile bounds', () => {
    for (let i = 0; i < 50; i++) {
      const ms = jitterMs('fast');
      expect(ms).toBeGreaterThanOrEqual(PROFILES.fast.minMs);
      expect(ms).toBeLessThanOrEqual(PROFILES.fast.maxMs);
    }
  });
});

describe('resolveProfile', () => {
  it('returns moderate by default', () => {
    expect(resolveProfile()).toBe(PROFILES.moderate);
  });

  it('resolves named profiles', () => {
    expect(resolveProfile('stealth')).toBe(PROFILES.stealth);
    expect(resolveProfile('none')).toBe(PROFILES.none);
  });

  it('falls back to moderate for unknown names', () => {
    expect(resolveProfile('nonexistent')).toBe(PROFILES.moderate);
  });
});
