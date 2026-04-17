import { cli, Strategy } from '@jackwener/opencli/registry';
import { getPlatformRule, listPlatformRules } from './platform-profiles.js';

cli({
  site: 'maybeai-image-app',
  name: 'rules',
  description: 'Show local platform-aware ratio, resolution, angle, and source rules',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'platform', positional: true, required: false, help: 'Optional platform, e.g. Amazon' },
  ],
  func: async (_page, kwargs) => {
    const platform = typeof kwargs.platform === 'string' ? kwargs.platform : undefined;
    return platform ? getPlatformRule(platform) : listPlatformRules();
  },
});
