// error-detail-canary.test.js
//
// Injection drift catch: every slock command evaluates a JS snippet inside
// the logged-in page, and the error envelopes (`detail:` / `where:`) are the
// one place where human-readable text and user input meet inside that
// snippet. Interpolating raw input INSIDE a quoted literal there lets a
// quote in the input close the string and run in the page (token exfil) —
// the exact bug fixed in message-send (497fe0ae) that then recurred in
// message-search and server-use. Encoded-at-build interpolation looks like
//   detail: 'no channel matches ' + ${JSON.stringify(channel)}
// (input outside the quotes, JSON-encoded); the forbidden form is
//   detail: 'no channel matches ${channel}'
// (input inside the quotes, raw).
//
// This canary greps every non-test slock source file for `detail:`/`where:`
// string literals that contain a `${...}` interpolation. The only allowed
// interpolation inside such a literal is the compile-time constant
// SLOCK_API_BASE. Node-side error messages (ArgumentError etc.) are not
// `detail:`/`where:` fields, so they don't trip this.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = path.dirname(fileURLToPath(import.meta.url));

const RAW_INTERPOLATION = /\$\{(?!SLOCK_API_BASE\})/;

// Returns human-readable offence descriptions for one file's source.
function findOffenders(src) {
  const noComments = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const offenders = [];

  // (a) The string literal directly assigned to detail:/where: — both quote
  // styles, so a future `detail: "no ${x}"` can't slip past a single-quote rule.
  for (const m of noComments.matchAll(/(detail|where)\s*:\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/g)) {
    if (RAW_INTERPOLATION.test(m[2])) offenders.push(`${m[1]}: ${m[2].slice(0, 60)}`);
  }

  // (b) Any single-quoted literal on a detail:/where: line — catches raw input
  // hidden in a later concatenated segment, e.g. detail: 'a' + 'bad ${x}'.
  for (const line of noComments.split('\n')) {
    if (!/\b(detail|where)\s*:/.test(line)) continue;
    for (const span of line.matchAll(/'(?:[^'\\\n]|\\.)*'/g)) {
      if (RAW_INTERPOLATION.test(span[0])) offenders.push(`segment: ${span[0].slice(0, 60)}`);
    }
  }
  return offenders;
}

describe('slock error-detail injection canary', () => {
  it('no detail:/where: literal in clis/slock/*.js interpolates raw input inside its quotes', () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
    const offenders = [];
    for (const f of files) {
      for (const hit of findOffenders(readFileSync(path.join(DIR, f), 'utf8'))) {
        offenders.push(`${f} → ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // Mutation proof — the checker actually catches the two historical bugs
  // verbatim, and does not flag the fixed forms or legit runtime concatenation.
  it('flags the historical vulnerable forms (message-search / server-use)', () => {
    // Rules (a) and (b) may both hit the same literal — assert "caught", not a count.
    expect(findOffenders(
      "if (!hit) return { kind: 'unresolvable', detail: 'no channel matches ${channel}' };"
    ).length).toBeGreaterThan(0);
    expect(findOffenders(
      'return { kind: \'unresolvable\', detail: \'no server matches "${raw}". Known slugs: \' + choices };'
    ).length).toBeGreaterThan(0);
    expect(findOffenders(
      "return { kind: 'unresolvable', detail: 'a' + 'bad ${x}' };"
    ).length).toBeGreaterThan(0);
  });

  it('does not flag encoded interpolation, SLOCK_API_BASE, or runtime concat of page vars', () => {
    expect(findOffenders(
      "if (!hit) return { kind: 'unresolvable', detail: 'no channel matches ' + ${JSON.stringify(channel)} };"
    )).toEqual([]);
    expect(findOffenders(
      "if (!res.ok) return { kind: 'http', status: res.status, where: '${SLOCK_API_BASE}/channels/' };"
    )).toEqual([]);
    // in-page.js resolveShortIdFragment style: page-side variable concatenated
    // OUTSIDE the quoted literals — the double quotes are literal content.
    expect(findOffenders(
      "return { kind: 'unresolvable', detail: 'short id \"' + ${shortIdVar} + '\" not found' };"
    )).toEqual([]);
  });
});
