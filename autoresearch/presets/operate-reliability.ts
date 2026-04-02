/**
 * Preset: Operate Command Reliability
 *
 * Optimizes opencli operate commands against the Layer 1 deterministic test suite.
 * Metric: number of passing browse-tasks (out of 59).
 */

import type { AutoResearchConfig } from '../config.js';

export const operateReliability: AutoResearchConfig = {
  goal: 'Increase operate command pass rate to 59/59 (100%)',
  scope: [
    'src/browser/dom-snapshot.ts',
    'src/browser/dom-helpers.ts',
    'src/browser/base-page.ts',
    'src/browser/page.ts',
    'src/cli.ts',
  ],
  metric: 'pass_count',
  direction: 'higher',
  verify: 'npx tsx autoresearch/eval-browse.ts 2>&1 | tail -1',
  guard: 'npm run build',
  minDelta: 1,
};
