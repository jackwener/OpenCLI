export { operateReliability } from './operate-reliability.js';
export { skillQuality } from './skill-quality.js';
export { v2exReliability } from './v2ex-reliability.js';

import type { AutoResearchConfig } from '../config.js';
import { operateReliability } from './operate-reliability.js';
import { skillQuality } from './skill-quality.js';
import { v2exReliability } from './v2ex-reliability.js';

export const PRESETS: Record<string, AutoResearchConfig> = {
  'operate-reliability': operateReliability,
  'skill-quality': skillQuality,
  'v2ex-reliability': v2exReliability,
};
