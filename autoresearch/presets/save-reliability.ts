/**
 * Preset: Save as CLI Reliability
 *
 * Optimizes the "Save as CLI" pipeline: browser init → write adapter → run.
 * Covers PUBLIC (no auth) and COOKIE (browser session) strategies.
 * Metric: number of passing save-tasks.
 */

import type { AutoResearchConfig } from '../config.js';

export const saveReliability: AutoResearchConfig = {
  goal: 'Increase "Save as CLI" pipeline pass rate to 100%. The flow is: browser init creates a scaffold, user writes adapter code, opencli discovers and runs it. Covers both PUBLIC (fetch API) and COOKIE (browser session) strategies. Focus on: init template correctness, user CLI discovery, adapter loading, verify command robustness, and browser session handling.',
  scope: [
    'src/cli.ts',
    'src/discovery.ts',
    'src/registry.ts',
    'skills/opencli-browser/SKILL.md',
    'autoresearch/save-tasks.json',
    'autoresearch/save-adapters/*.ts',
  ],
  metric: 'pass_count',
  direction: 'higher',
  verify: 'npx tsx autoresearch/eval-save.ts 2>&1 | tail -1',
  guard: 'npm run build',
  minDelta: 1,
};
