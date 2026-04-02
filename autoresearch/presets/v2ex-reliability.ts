/**
 * Preset: V2EX Command Reliability
 *
 * Optimizes opencli operate commands against the V2EX-specific test suite.
 * 40 tasks across 5 difficulty layers (atomic → complex chain).
 */

import type { AutoResearchConfig } from '../config.js';

export const v2exReliability: AutoResearchConfig = {
  goal: 'Increase V2EX operate command pass rate to 40/40 (100%)',
  scope: [
    'src/browser/dom-snapshot.ts',
    'src/browser/dom-helpers.ts',
    'src/browser/base-page.ts',
    'src/browser/page.ts',
    'src/cli.ts',
  ],
  metric: 'pass_count',
  direction: 'higher',
  verify: 'npx tsx autoresearch/eval-v2ex.ts 2>&1 | tail -1',
  guard: 'npm run build',
  minDelta: 1,
};
