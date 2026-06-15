// server-override-canary.test.js
//
// R1 drift catch (source-level, registry-wide): any slock command that
// scopes to a server MUST route its X-Server-Id through authHeadersFragment.
// authHeadersFragment owns the UUID-vs-slug resolution against /servers/;
// a hand-rolled `let sid = ${override}; if (!sid) {...}` copy in a
// command file is the bug class that landed Jacky's `--server community`
// at HTTP 500 even though the active-slug path was fine.
//
// This canary scans every clis/slock/*.js file for the offending shape
// and asserts that any file that mentions `x-server-id` (the request
// header) does so via authHeadersFragment, not its own header object.
// It catches the message-read / message-search / message-send class of
// inline-copy bugs that R1 v1 missed (the byte-verify mocks never set a
// slug override, so the copies went unnoticed until live).

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = path.dirname(fileURLToPath(import.meta.url));

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('slock R1 server-override canary', () => {
  it('no clis/slock/*.js (except in-page.js) hand-rolls a `let sid = <override>; if (!sid)` server-resolve copy', () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

    const offenders = [];
    for (const f of files) {
      // in-page.js is the single source of truth — it OWNS the resolve.
      if (f === 'in-page.js') continue;
      // shared.js holds constants only.
      if (f === 'shared.js') continue;
      const src = stripComments(readFileSync(path.join(DIR, f), 'utf8'));

      // The offending inline-copy shape: a `let sid` declaration followed
      // (within a snippet) by an `if (!sid)` block that does its own
      // /servers/ lookup. Match across newlines because snippets are
      // formatted as template literals.
      const inlineCopy = /let\s+sid\s*=[^;]*;\s*if\s*\(\s*!\s*sid\s*\)/s;
      if (inlineCopy.test(src)) {
        offenders.push(`${f} (inline \`let sid = ...; if (!sid)\` copy)`);
      }

      // Also: hand-crafting `'x-server-id'` in a headers literal is a smell.
      // The only place that should set this header is authHeadersFragment.
      // (in-page.js excluded above, so any hit here is a copy.)
      if (/['"]x-server-id['"]\s*:/.test(src)) {
        offenders.push(`${f} (hand-crafted 'x-server-id' header in source)`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('any file that mentions /servers/ either IS in-page.js or imports authHeadersFragment', () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

    const offenders = [];
    for (const f of files) {
      if (f === 'in-page.js' || f === 'shared.js') continue;
      const src = readFileSync(path.join(DIR, f), 'utf8');
      const noComments = stripComments(src);
      // server-use legitimately fetches /servers/ for its own purpose
      // (setting active-slug) and explicitly does not use the auth
      // header chain. Exempt by name.
      if (f === 'server-use.js' || f === 'server-list.js') continue;
      // unread-summary makes a /servers/ probe too (separate flow).
      if (f === 'unread-summary.js') continue;
      if (!/\/servers\//.test(noComments)) continue;
      // Any other file mentioning /servers/ is suspicious — it should be
      // delegating to authHeadersFragment.
      if (!/authHeadersFragment/.test(noComments)) {
        offenders.push(`${f} touches /servers/ without authHeadersFragment`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
