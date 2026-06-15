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
// This canary scans every non-test slock source file: on each line carrying
// a `detail:`/`where:` field, every quoted literal (single, double, or
// template — including the \`…\` escaped form template literals take inside
// the outer snippet template) must be free of `${...}` interpolation, except
// the compile-time constant SLOCK_API_BASE. Node-side error messages
// (ArgumentError etc.) are not `detail:`/`where:` fields, so they don't trip.
//
// Known limitations (accepted): a detail string built in a separate variable
// and a concatenation continued on the next line are out of reach of a
// line-based scan. Both have no precedent in this adapter's snippet style.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = path.dirname(fileURLToPath(import.meta.url));

const RAW_INTERPOLATION = /\$\{(?!SLOCK_API_BASE\})/;

// Extracts the contents of quoted literals from one line of source. A real
// tokenizer (not a per-quote regex) because the snippet style nests quote
// characters: in `'short id "' + x + '" not found'` the double quotes are
// CONTENT of single-quoted literals — a naive /"..."/ scan would invent a
// phantom span around `' + x + '` and false-positive. Handles '…', "…",
// raw `…`, and the \`…\` form, with backslash escapes.
function quotedSpans(line) {
  const spans = [];
  let i = 0;
  while (i < line.length) {
    const escapedTick = line[i] === '\\' && line[i + 1] === '`';
    if (!escapedTick && line[i] !== "'" && line[i] !== '"' && line[i] !== '`') {
      i += 1;
      continue;
    }
    const close = escapedTick ? '\\`' : line[i];
    let j = i + (escapedTick ? 2 : 1);
    let span = '';
    while (j < line.length) {
      if (close === '\\`' && line[j] === '\\' && line[j + 1] === '`') break;
      if (line[j] === '\\') { span += line.slice(j, j + 2); j += 2; continue; }
      if (close !== '\\`' && line[j] === close) break;
      span += line[j]; j += 1;
    }
    spans.push(span);
    i = j + close.length;
  }
  return spans;
}

// Returns human-readable offence descriptions for one file's source.
function findOffenders(src) {
  const noComments = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const offenders = [];
  for (const line of noComments.split('\n')) {
    if (!/\b(detail|where)\s*:/.test(line)) continue;
    for (const span of quotedSpans(line)) {
      if (RAW_INTERPOLATION.test(span)) offenders.push(`raw interpolation in: ${span.slice(0, 60)}`);
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

  // Mutation proof — the checker actually catches the historical bugs
  // verbatim plus the quote-variant forms, and stays quiet on the fixed
  // forms and legit runtime concatenation.
  it('flags the historical vulnerable forms (message-search / server-use)', () => {
    expect(findOffenders(
      "if (!hit) return { kind: 'unresolvable', detail: 'no channel matches ${channel}' };"
    ).length).toBeGreaterThan(0);
    expect(findOffenders(
      'return { kind: \'unresolvable\', detail: \'no server matches "${raw}". Known slugs: \' + choices };'
    ).length).toBeGreaterThan(0);
  });

  it('flags double-quoted, template-literal, and concatenated-segment variants', () => {
    expect(findOffenders(
      "return { kind: 'unresolvable', detail: \"bad ${x}\" };"
    ).length).toBeGreaterThan(0);
    // Template literal as it appears inside the outer snippet template: \`…\`
    expect(findOffenders(
      "return { kind: 'unresolvable', detail: \\`no channel matches ${channel}\\` };"
    ).length).toBeGreaterThan(0);
    // Raw input hidden in a later concatenated segment, either quote style.
    expect(findOffenders(
      "return { kind: 'unresolvable', detail: 'a' + 'bad ${x}' };"
    ).length).toBeGreaterThan(0);
    expect(findOffenders(
      "return { kind: 'unresolvable', detail: 'a' + \"bad ${x}\" };"
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
    // OUTSIDE the quoted literals — the double quotes are literal content and
    // must not be misread as span delimiters around the variable.
    expect(findOffenders(
      "return { kind: 'unresolvable', detail: 'short id \"' + ${shortIdVar} + '\" not found' };"
    )).toEqual([]);
    // in-page.js authHeadersFragment style: many alternating segments + a
    // \`…\` hint nested INSIDE a single-quoted literal stays content.
    expect(findOffenders(
      "return { kind: 'no-server', detail: 'slug \"' + __slug + '\" not in /servers/' + '. Known slugs: ' + __choices };"
    )).toEqual([]);
    expect(findOffenders(
      "return { kind: 'no-server', detail: 'run \\`slock server-use <slug>\\` or pass --server <slug>' };"
    )).toEqual([]);
  });
});
