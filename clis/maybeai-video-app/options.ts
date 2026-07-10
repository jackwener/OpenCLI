import { cli, Strategy } from '@jackwener/opencli/registry';
import { getOptions } from './profiles.js';

cli({
  site: 'maybeai-video-app',
  name: 'options',
  access: 'read',
  description: 'List local supported platforms, markets, categories, ratios, durations, styles, and video models',
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
