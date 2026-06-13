// site-session-canary.test.js
//
// Registry-based drift catch (NOT grep-based): every slock command that uses
// the cookie/browser strategy MUST declare siteSession='persistent'. The
// framework default is 'ephemeral' (see src/execution.ts:497), which means
// without this flag, the command spins up a fresh browser profile that does
// NOT share localStorage with the `login` command's persistent profile.
// Result: a fully successful `login` leaves every other command reading an
// empty profile → AUTH_REQUIRED.
//
// We discover commands via the registry (not grep over clis/slock/*.js)
// because `whoami` and `login` are registered from clis/_shared/site-auth.js,
// and a grep approach would miss them. Registry iteration also covers any
// future Ph10+ commands the moment they get registered — drift-proof.

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { getRegistry } from '@jackwener/opencli/registry';

const DIR = path.dirname(fileURLToPath(import.meta.url));

describe('slock site-session canary', () => {
  it('every cookie/browser slock command sets siteSession="persistent" (shares login\'s profile)', async () => {
    // Side-effect-import every adapter .js in this directory so cli() runs.
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
    for (const f of files) {
      await import(pathToFileURL(path.join(DIR, f)).href);
    }

    const registry = getRegistry();
    const slock = [...registry.entries()].filter(([k]) => k.startsWith('slock/'));

    // Sanity: at least the ~44 commands we expect from Ph0-9 — guards
    // against the test silently passing if discovery somehow returned 0.
    expect(slock.length).toBeGreaterThan(40);

    const offenders = slock
      // Only cookie/browser commands need a persistent session. PUBLIC /
      // browserless commands aren't affected.
      .filter(([, cmd]) => cmd.strategy === 'cookie' && cmd.browser)
      .filter(([, cmd]) => cmd.siteSession !== 'persistent')
      .map(([k, cmd]) => `${k} (siteSession=${cmd.siteSession ?? 'unset (defaults ephemeral)'})`);

    expect(offenders).toEqual([]);
  });
});
