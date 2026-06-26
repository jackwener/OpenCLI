// api-base-canary.test.js
//
// Origin drift catch: slock is split-origin (token at app.slock.ai, API at
// api.slock.ai). Every fetch in clis/slock MUST go through SLOCK_API_BASE
// — a hardcoded '/api/...' literal would silently land on the SPA host
// (app.slock.ai/api/...) instead of the API host, producing the exact
// AUTH_REQUIRED / HTML-instead-of-JSON / "identity empty" symptoms we just
// spent hours diagnosing.
//
// This canary greps every slock command source file (excluding shared.js,
// where SLOCK_API_BASE itself is defined, and the comments) for any string
// literal that starts with '/api/' or "/api/". If anything matches, a future
// command leaked a hardcoded path and must be re-routed through
// SLOCK_API_BASE.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = path.dirname(fileURLToPath(import.meta.url));

describe('slock SLOCK_API_BASE canary', () => {
  it('no clis/slock/*.js file contains a hardcoded "/api/..." string literal (must use SLOCK_API_BASE)', () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

    const offenders = [];
    for (const f of files) {
      // shared.js is the single source of truth — its constant value contains
      // '/api' as the trailing path of the absolute URL, and its comment
      // explicitly references the literal we are forbidding elsewhere.
      if (f === 'shared.js') continue;
      const src = readFileSync(path.join(DIR, f), 'utf8');

      // Strip line and block comments so a comment that mentions '/api/'
      // doesn't trip the canary. Test code, drift docs and other strings
      // intentionally talking about '/api/' belong in comments / *.test.js.
      const noComments = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      // Forbidden pattern: a string literal whose first chars are '/api/'.
      // Cover single-quote, double-quote, AND backtick forms — a future
      // refactor that pastes `\`/api/foo\`` (template literal) would slip
      // past a char class missing the backtick.
      const hits = (noComments.match(/(['"`])\/api\//g) || []);
      if (hits.length) offenders.push(`${f} (${hits.length} hardcoded '/api/...' literal${hits.length === 1 ? '' : 's'})`);
    }

    expect(offenders).toEqual([]);
  });

  it('SLOCK_API_BASE is the absolute prod URL — never a relative "/api"', async () => {
    const { SLOCK_API_BASE } = await import('./shared.js');
    // Must start with https:// so fetches inside page.evaluate (which runs
    // on app.slock.ai) actually hit the API host instead of the SPA.
    expect(SLOCK_API_BASE.startsWith('https://')).toBe(true);
    // And end in /api so concatenation with '/messages' etc gives the right path.
    expect(SLOCK_API_BASE.endsWith('/api')).toBe(true);
  });
});
