// short-id-canary.test.js
//
// R3 drift catch (source-level, registry-wide): the short-id → full-UUID
// resolution (`#channel:shortId` via GET /api/messages/context/...) used to
// be copy-pasted into message-read, message-send, and task-convert. The
// Phase 7.1 bug class — reading `m.message.id` instead of
// `cxd.targetMessageId`, or mapping the context-404 to NO_THREAD — bit us
// in every previous rewrite because each consumer carried its own copy.
//
// R3 consolidates that resolution into a single helper in in-page.js
// (`resolveShortIdFragment`). This canary scans every other clis/slock/*.js
// for the offending copy shape and asserts that any file referencing
// `cxd.targetMessageId` does so via the helper, not by hand.
//
// ⚠️ EXEMPTION: message-read.js also calls /api/messages/context for the
// `--after <seq>` anchor flow (line ~143). That is a SEPARATE consumer:
// it reads `cxd.messages` to find a seq anchor, NEVER mutates a shortId
// variable, and does NOT read targetMessageId. The canary keys on the
// shortId-resolve fingerprint (`fullMsgId = cxd.targetMessageId` and
// friends), so the --after path is naturally not flagged.

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

describe('slock R3 short-id resolution canary', () => {
  it('no clis/slock/*.js (except in-page.js) hand-rolls a short-id → cxd.targetMessageId resolution', () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

    const offenders = [];
    for (const f of files) {
      // in-page.js OWNS resolveShortIdFragment.
      if (f === 'in-page.js') continue;
      if (f === 'shared.js') continue;
      const src = stripComments(readFileSync(path.join(DIR, f), 'utf8'));

      // Fingerprint of the inline-copy short-id resolve: an ASSIGNMENT
      // whose right-hand side is `cxd.targetMessageId`. The --after
      // seq-anchor flow legitimately COMPARES against targetMessageId
      // (`m.messageId === cxd.targetMessageId`), so the regex must
      // exclude comparison operators. Negative lookbehind `(?<![=!])`
      // rules out `==`/`===`/`!=`/`!==`.
      if (/(?<![=!])=\s*cxd\.targetMessageId/.test(src)) {
        offenders.push(`${f} (assigns from cxd.targetMessageId — should call resolveShortIdFragment)`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('all 3 known short-id consumers import resolveShortIdFragment from in-page.js', () => {
    const expected = ['message-read.js', 'message-send.js', 'task-convert.js'];
    const missing = [];
    for (const f of expected) {
      const src = readFileSync(path.join(DIR, f), 'utf8');
      if (!/resolveShortIdFragment/.test(src)) {
        missing.push(`${f} (still hand-rolls short-id resolution)`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('exempt --after seq-anchor flow in message-read.js still uses /messages/context (regression catch — do not delete it by accident)', () => {
    const src = readFileSync(path.join(DIR, 'message-read.js'), 'utf8');
    // The --after flow walks the cxd.messages array to find the seq
    // anchor for a UUID. It MUST still appear in source — if a future
    // refactor strips it, --after <UUID> stops working silently.
    expect(src).toMatch(/\/messages\/context\/'?\s*\+\s*encodeURIComponent\(afterSeq\)/);
    expect(src).toMatch(/cxd\.messages/);
    // It legitimately compares against cxd.targetMessageId (`m.id ===
    // cxd.targetMessageId`) to find the right row — that comparison
    // form must stay, distinct from the assignment form the short-id
    // helper owns.
    expect(src).toMatch(/===\s*cxd\.targetMessageId/);
  });
});
