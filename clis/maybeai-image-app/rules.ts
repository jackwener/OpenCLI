import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { MAYBEAI_PLATFORMS, type MaybeAiPlatform } from './profiles.js';
import { getMaybeAiPlatformRule, listMaybeAiPlatformRules } from './platform-profiles.js';

cli({
  site: 'maybeai-image-app',
  name: 'rules',
  description: 'Show MaybeAI platform-aware image ratio, resolution, angle, and source rules',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    {
      name: 'platform',
      positional: true,
      required: false,
      choices: [...MAYBEAI_PLATFORMS],
      help: 'Platform to inspect',
    },
  ],
  func: async (_page, kwargs) => {
    if (typeof kwargs.platform === 'string') {
      const platform = kwargs.platform as MaybeAiPlatform;
      if (!MAYBEAI_PLATFORMS.includes(platform)) {
        throw new ArgumentError(
          `Invalid platform: ${platform}`,
          `Allowed platform values: ${MAYBEAI_PLATFORMS.join(', ')}`,
        );
      }
      return getMaybeAiPlatformRule(platform);
    }
    return listMaybeAiPlatformRules();
  },
});
