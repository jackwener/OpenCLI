import { describe, expect, it } from 'vitest';
import {
  PACING_BREAKER_THRESHOLD,
  PACING_BREAKER_WINDOW_MS,
  PACING_COOLDOWN_MAX_MS,
  PACING_COOLDOWN_MIN_MS,
  SECURITY_COOLDOWN_CODE,
  SITE_PACING_RULES,
  SitePacer,
  buildSecurityCooldownFailure,
  classifyPacedNavigation,
  parseSiteFromSession,
} from './site-pacing.js';

const RULES = { paced: { minIntervalMs: 1000, maxIntervalMs: 2000 } };
const CTX = 'ctx-1';

describe('parseSiteFromSession', () => {
  it('extracts the site from persistent and ephemeral adapter session names', () => {
    expect(parseSiteFromSession('site:xiaohongshu')).toBe('xiaohongshu');
    expect(parseSiteFromSession('site:weibo:3d6f0d5e-uuid')).toBe('weibo');
  });
  it('returns null for non-adapter sessions and non-strings', () => {
    expect(parseSiteFromSession('my-browser-session')).toBeNull();
    expect(parseSiteFromSession('')).toBeNull();
    expect(parseSiteFromSession(undefined)).toBeNull();
    expect(parseSiteFromSession(42)).toBeNull();
  });
});

describe('SitePacer navigation slots', () => {
  it('lets unpaced sites through with zero delay', () => {
    const pacer = new SitePacer(RULES, () => 0.5);
    expect(pacer.acquireNavigationSlot(CTX, 'unlisted', 1_000)).toEqual({ granted: true, delayMs: 0 });
  });

  it('grants the first navigation immediately', () => {
    const pacer = new SitePacer(RULES, () => 0.5);
    expect(pacer.acquireNavigationSlot(CTX, 'paced', 1_000)).toEqual({ granted: true, delayMs: 0 });
  });

  it('spaces an immediate follow-up navigation by the jittered interval', () => {
    const pacer = new SitePacer(RULES, () => 0.5); // interval = 1000 + 0.5*1000 = 1500
    pacer.acquireNavigationSlot(CTX, 'paced', 1_000);
    expect(pacer.acquireNavigationSlot(CTX, 'paced', 1_000)).toEqual({ granted: true, delayMs: 1_500 });
  });

  it('serializes concurrent bursts into consecutive slots', () => {
    const pacer = new SitePacer(RULES, () => 0); // interval = 1000
    pacer.acquireNavigationSlot(CTX, 'paced', 1_000);
    expect(pacer.acquireNavigationSlot(CTX, 'paced', 1_000)).toEqual({ granted: true, delayMs: 1_000 });
    expect(pacer.acquireNavigationSlot(CTX, 'paced', 1_000)).toEqual({ granted: true, delayMs: 2_000 });
  });

  it('does not delay a navigation that arrives after the interval has already passed', () => {
    const pacer = new SitePacer(RULES, () => 1); // interval = 2000
    pacer.acquireNavigationSlot(CTX, 'paced', 1_000);
    expect(pacer.acquireNavigationSlot(CTX, 'paced', 5_000)).toEqual({ granted: true, delayMs: 0 });
  });

  it('partitions slots by contextId — two Chrome profiles never pace each other', () => {
    const pacer = new SitePacer(RULES, () => 0.5);
    pacer.acquireNavigationSlot('ctx-a', 'paced', 1_000);
    expect(pacer.acquireNavigationSlot('ctx-b', 'paced', 1_000)).toEqual({ granted: true, delayMs: 0 });
  });
});

describe('SitePacer circuit breaker', () => {
  it('opens after the threshold of security blocks inside the window', () => {
    const pacer = new SitePacer(RULES, () => 0); // cooldown = PACING_COOLDOWN_MIN_MS
    for (let i = 0; i < PACING_BREAKER_THRESHOLD; i++) {
      pacer.reportOutcome(CTX, 'paced', 'security_block', 1_000 + i);
    }
    const outcome = pacer.acquireNavigationSlot(CTX, 'paced', 2_000);
    expect(outcome.granted).toBe(false);
    if (!outcome.granted) {
      expect(outcome.retryAfterMs).toBe(PACING_COOLDOWN_MIN_MS - (2_000 - (1_000 + PACING_BREAKER_THRESHOLD - 1)));
    }
  });

  it('randomizes the open duration within the documented bounds', () => {
    const pacer = new SitePacer(RULES, () => 1);
    for (let i = 0; i < PACING_BREAKER_THRESHOLD; i++) {
      pacer.reportOutcome(CTX, 'paced', 'security_block', 1_000);
    }
    const outcome = pacer.acquireNavigationSlot(CTX, 'paced', 1_000);
    expect(outcome.granted).toBe(false);
    if (!outcome.granted) expect(outcome.retryAfterMs).toBe(PACING_COOLDOWN_MAX_MS);
  });

  it('an ok outcome resets the block counter', () => {
    const pacer = new SitePacer(RULES, () => 0);
    pacer.reportOutcome(CTX, 'paced', 'security_block', 1_000);
    pacer.reportOutcome(CTX, 'paced', 'ok', 2_000);
    pacer.reportOutcome(CTX, 'paced', 'security_block', 3_000);
    expect(pacer.acquireNavigationSlot(CTX, 'paced', 3_500).granted).toBe(true);
  });

  it('prunes blocks older than the window instead of counting them', () => {
    const pacer = new SitePacer(RULES, () => 0);
    pacer.reportOutcome(CTX, 'paced', 'security_block', 1_000);
    pacer.reportOutcome(CTX, 'paced', 'security_block', 1_000 + PACING_BREAKER_WINDOW_MS + 1);
    expect(pacer.acquireNavigationSlot(CTX, 'paced', 1_000 + PACING_BREAKER_WINDOW_MS + 2).granted).toBe(true);
  });

  it('closes again once the open period has elapsed', () => {
    const pacer = new SitePacer(RULES, () => 0);
    for (let i = 0; i < PACING_BREAKER_THRESHOLD; i++) {
      pacer.reportOutcome(CTX, 'paced', 'security_block', 1_000);
    }
    expect(pacer.acquireNavigationSlot(CTX, 'paced', 1_000 + PACING_COOLDOWN_MIN_MS + 1).granted).toBe(true);
  });

  it('ignores reports for unpaced sites', () => {
    const pacer = new SitePacer(RULES, () => 0);
    for (let i = 0; i < 10; i++) pacer.reportOutcome(CTX, 'unlisted', 'security_block', 1_000);
    expect(pacer.acquireNavigationSlot(CTX, 'unlisted', 1_001)).toEqual({ granted: true, delayMs: 0 });
  });

  it('partitions breaker state by contextId', () => {
    const pacer = new SitePacer(RULES, () => 0);
    for (let i = 0; i < PACING_BREAKER_THRESHOLD; i++) {
      pacer.reportOutcome('ctx-a', 'paced', 'security_block', 1_000);
    }
    expect(pacer.acquireNavigationSlot('ctx-b', 'paced', 1_001).granted).toBe(true);
  });
});

describe('classifyPacedNavigation', () => {
  const rules = { xiaohongshu: { minIntervalMs: 1000, maxIntervalMs: 2000 } };
  it('matches adapter navigate dispatches for paced sites, persistent or ephemeral', () => {
    expect(classifyPacedNavigation({ action: 'navigate', surface: 'adapter', session: 'site:xiaohongshu' }, rules)).toBe('xiaohongshu');
    expect(classifyPacedNavigation({ action: 'navigate', surface: 'adapter', session: 'site:xiaohongshu:uuid-1' }, rules)).toBe('xiaohongshu');
  });
  it('ignores non-navigate actions, non-adapter surfaces, and unpaced sites', () => {
    expect(classifyPacedNavigation({ action: 'exec', surface: 'adapter', session: 'site:xiaohongshu' }, rules)).toBeNull();
    expect(classifyPacedNavigation({ action: 'navigate', surface: 'browser', session: 'site:xiaohongshu' }, rules)).toBeNull();
    expect(classifyPacedNavigation({ action: 'navigate', surface: 'adapter', session: 'site:weibo' }, rules)).toBeNull();
    expect(classifyPacedNavigation({ action: 'navigate', surface: 'adapter' }, rules)).toBeNull();
    expect(classifyPacedNavigation({}, rules)).toBeNull();
  });
});

describe('buildSecurityCooldownFailure', () => {
  it('produces a machine-readable 429 with a whole-seconds retry hint', () => {
    const failure = buildSecurityCooldownFailure('xiaohongshu', 90_500);
    expect(failure.status).toBe(429);
    expect(failure.errorCode).toBe(SECURITY_COOLDOWN_CODE);
    expect(failure.retryAfterMs).toBe(90_500);
    expect(failure.message).toContain('xiaohongshu');
    expect(failure.errorHint).toContain('91');
  });
});

describe('shipped pacing defaults', () => {
  it('covers xiaohongshu and weibo within the documented pitfall bounds', () => {
    // sitemaps/xiaohongshu/pitfalls.md: keep 1-2s between consecutive requests.
    for (const site of ['xiaohongshu', 'weibo']) {
      const rule = SITE_PACING_RULES[site];
      expect(rule, `${site} missing from SITE_PACING_RULES`).toBeDefined();
      expect(rule.minIntervalMs).toBeGreaterThanOrEqual(1_000);
      expect(rule.maxIntervalMs).toBeLessThanOrEqual(3_000);
      expect(rule.minIntervalMs).toBeLessThan(rule.maxIntervalMs);
    }
  });
  it('exposes a machine-readable cooldown error code and sane breaker constants', () => {
    expect(SECURITY_COOLDOWN_CODE).toBe('security_cooldown');
    expect(PACING_BREAKER_THRESHOLD).toBeGreaterThanOrEqual(2);
    expect(PACING_BREAKER_WINDOW_MS).toBeGreaterThan(0);
    expect(PACING_COOLDOWN_MIN_MS).toBeLessThan(PACING_COOLDOWN_MAX_MS);
  });
});
