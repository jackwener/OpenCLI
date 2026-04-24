/**
 * Preset: Skill E2E Quality
 *
 * Optimizes the opencli-adapter-author SKILL.md against the Layer 2 LLM E2E test suite.
 * Metric: number of passing skill-tasks (out of 35).
 */

import type { AutoResearchConfig } from '../config.js';

export const skillQuality: AutoResearchConfig = {
  goal: 'Increase skill E2E pass rate to 35/35 (100%)',
  scope: [
    'skills/opencli-adapter-author/SKILL.md',
  ],
  metric: 'pass_count',
  direction: 'higher',
  verify: 'npx tsx autoresearch/eval-skill.ts 2>&1 | tail -1',
  guard: 'npm run build',
  iterations: 20,
};
