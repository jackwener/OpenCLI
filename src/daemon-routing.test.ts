import { describe, expect, it } from 'vitest';

import { parseHello, resolveRoute, type ProfileSummary } from './daemon-routing.js';

describe('parseHello', () => {
  it('rejects non-object input', () => {
    expect(parseHello(null)).toBeNull();
    expect(parseHello(undefined)).toBeNull();
    expect(parseHello('hello')).toBeNull();
    expect(parseHello(42)).toBeNull();
  });

  it('rejects messages that are not hellos', () => {
    expect(parseHello({ type: 'log', msg: 'x' })).toBeNull();
    expect(parseHello({})).toBeNull();
  });

  it('parses a modern hello with profileId + profileLabel', () => {
    expect(
      parseHello({
        type: 'hello',
        version: '1.2.3',
        compatRange: '>=1.7.0',
        profileId: 'abc-123',
        profileLabel: 'Profile-abc12345',
      }),
    ).toEqual({
      profileId: 'abc-123',
      profileLabel: 'Profile-abc12345',
      version: '1.2.3',
      compatRange: '>=1.7.0',
    });
  });

  it('treats empty profileId / profileLabel as missing (so daemon can synthesise)', () => {
    expect(
      parseHello({ type: 'hello', profileId: '', profileLabel: '', version: '1.0' }),
    ).toEqual({ profileId: undefined, profileLabel: undefined, version: '1.0', compatRange: null });
  });

  it('accepts legacy hellos without profileId (pre-multiplex extension)', () => {
    expect(parseHello({ type: 'hello', version: '1.0.2', compatRange: '>=1.6.0' })).toEqual({
      profileId: undefined,
      profileLabel: undefined,
      version: '1.0.2',
      compatRange: '>=1.6.0',
    });
  });
});

const WORK: ProfileSummary = { profileId: 'uuid-work', profileLabel: 'work@example.com' };
const HOME: ProfileSummary = { profileId: 'uuid-home', profileLabel: 'home@example.com' };

describe('resolveRoute', () => {
  it('503s when nothing is connected', () => {
    expect(resolveRoute(undefined, [])).toMatchObject({ ok: false, status: 503 });
    expect(resolveRoute('work@example.com', [])).toMatchObject({ ok: false, status: 503 });
  });

  it('auto-routes the single connected profile (unchanged backward-compat)', () => {
    expect(resolveRoute(undefined, [WORK])).toEqual({ ok: true, profileId: 'uuid-work' });
  });

  it('409s on multiple connected with no choice, surfacing the list', () => {
    const r = resolveRoute(undefined, [WORK, HOME]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.connected).toEqual([WORK, HOME]);
    }
  });

  it('matches a requested profile by label', () => {
    expect(resolveRoute('home@example.com', [WORK, HOME])).toEqual({
      ok: true,
      profileId: 'uuid-home',
    });
  });

  it('matches a requested profile by profileId', () => {
    expect(resolveRoute('uuid-work', [WORK, HOME])).toEqual({
      ok: true,
      profileId: 'uuid-work',
    });
  });

  it('404s when the requested profile is not in the connected set', () => {
    const r = resolveRoute('nope', [WORK, HOME]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(404);
      expect(r.error).toContain('nope');
      expect(r.connected).toEqual([WORK, HOME]);
    }
  });

  it('prefers exact match even when a single profile is connected', () => {
    const r = resolveRoute('wrong-label', [WORK]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });
});
