import { cli, Strategy } from '@jackwener/opencli/registry';
import { getModelProfile, listModelProfiles } from './model-profiles.js';

cli({
  site: 'maybeai-image-app',
  name: 'models',
  description: 'Show local MaybeAI image model priority and supported aspect ratios',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'model', positional: true, required: false, help: 'Optional model id' },
  ],
  func: async (_page, kwargs) => {
    const model = typeof kwargs.model === 'string' ? kwargs.model : undefined;
    return model ? getModelProfile(model) : listModelProfiles();
  },
});
