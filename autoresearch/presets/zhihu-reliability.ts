/**
 * Preset: Zhihu Command Reliability
 *
 * Optimizes opencli operate commands against the Zhihu test suite.
 * 60 tasks across 8 difficulty layers (atomic → complex long chain).
 * Zhihu is a React SPA with lazy loading, making it harder than V2EX.
 */

import type { AutoResearchConfig } from '../config.js';

export const zhihuReliability: AutoResearchConfig = {
  goal: 'Increase Zhihu operate command pass rate to 60/60 (100%)',
  scope: [
    'src/browser/dom-snapshot.ts',
    'src/browser/dom-helpers.ts',
    'src/browser/base-page.ts',
    'src/browser/page.ts',
    'src/cli.ts',
  ],
  metric: 'pass_count',
  direction: 'higher',
  verify: 'npx tsx autoresearch/eval-zhihu.ts 2>&1 | tail -1',
  guard: 'npm run build',
  minDelta: 1,
};
