/**
 * Preset: Combined Reliability (browse + V2EX + Zhihu)
 *
 * Optimizes across ALL test suites simultaneously.
 * Current baseline: 57/59 + 60/60 + 60/60 = 177/179
 * Target: 179/179 (100%)
 */

import type { AutoResearchConfig } from '../config.js';

export const combinedReliability: AutoResearchConfig = {
  goal: 'Fix all remaining test failures across browse + V2EX + Zhihu (177/179 → 179/179)',
  scope: [
    'src/browser/dom-snapshot.ts',
    'src/browser/dom-helpers.ts',
    'src/browser/base-page.ts',
    'src/browser/page.ts',
    'src/cli.ts',
    'autoresearch/browse-tasks.json',
  ],
  metric: 'pass_count',
  direction: 'higher',
  verify: 'npx tsx autoresearch/eval-all.ts 2>&1 | tail -1',
  guard: 'npm run build',
  iterations: 10,
  minDelta: 1,
};
