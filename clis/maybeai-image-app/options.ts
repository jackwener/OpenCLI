import { cli, Strategy } from '@jackwener/opencli/registry';
import { getOptions } from './profiles.js';

cli({
  site: 'maybeai-image-app',
  name: 'options',
  description: 'List local supported platforms, countries, categories, angles, ratios, resolutions, models, and image kinds',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'kind', positional: true, required: false, help: 'Optional option kind' },
  ],
  func: async (_page, kwargs) => {
    const kind = typeof kwargs.kind === 'string' ? kwargs.kind : undefined;
    return getOptions(kind);
  },
});
