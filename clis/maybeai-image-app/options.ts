import { cli, Strategy } from '@jackwener/opencli/registry';
import { getMaybeAiOptions, type MaybeAiOptionKind } from './profiles.js';

cli({
  site: 'maybeai-image-app',
  name: 'options',
  description: 'List supported MaybeAI platforms, countries/regions, categories, angles, ratios, resolutions, models, and image kinds',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    {
      name: 'kind',
      positional: true,
      required: false,
      choices: ['platform', 'country', 'angle', 'category', 'ratio', 'resolution', 'model', 'image-kind'],
      help: 'Option kind to list',
    },
  ],
  func: async (_page, kwargs) => {
    const kind = typeof kwargs.kind === 'string' ? kwargs.kind as MaybeAiOptionKind : undefined;
    return getMaybeAiOptions(kind);
  },
});
