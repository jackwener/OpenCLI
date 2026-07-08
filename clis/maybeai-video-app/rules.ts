import { cli, Strategy } from '@jackwener/opencli/registry';
import { getPlatformRule, listPlatformRules } from './platform-profiles.js';

cli({
  site: 'maybeai-video-app',
  name: 'rules',
  access: 'read',
  description: 'Show local platform-aware ratio and duration defaults for video generation',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'platform', positional: true, required: false, help: 'Optional platform, e.g. TikTokShop' },
  ],
  func: async (_page, kwargs) => {
    const platform = typeof kwargs.platform === 'string' ? kwargs.platform : undefined;
    return platform ? getPlatformRule(platform) : listPlatformRules();
  },
});
