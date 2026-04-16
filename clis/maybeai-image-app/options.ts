import { cli, Strategy } from '@jackwener/opencli/registry';
import { API_ARGS, maybeAiAppGet } from './common.js';

cli({
  site: 'maybeai-image-app',
  name: 'options',
  description: 'List supported platforms, countries, categories, angles, ratios, resolutions, models, and image kinds',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'kind', positional: true, required: false, help: 'Optional option kind' },
    ...API_ARGS,
  ],
  func: async (_page, kwargs) => {
    const kind = typeof kwargs.kind === 'string' ? kwargs.kind : undefined;
    return maybeAiAppGet(kind ? `/api/v1/image-app/options/${encodeURIComponent(kind)}` : '/api/v1/image-app/options', kwargs);
  },
});
