import { cli, Strategy } from '@jackwener/opencli/registry';
import { API_ARGS, maybeAiAppGet } from './common.js';

cli({
  site: 'maybeai-image-app',
  name: 'rules',
  description: 'Show platform-aware ratio, resolution, angle, and source rules from the API',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'platform', positional: true, required: false, help: 'Optional platform, e.g. Amazon' },
    ...API_ARGS,
  ],
  func: async (_page, kwargs) => {
    const platform = typeof kwargs.platform === 'string' ? kwargs.platform : undefined;
    return maybeAiAppGet(platform ? `/api/v1/image-app/rules/${encodeURIComponent(platform)}` : '/api/v1/image-app/rules', kwargs);
  },
});
