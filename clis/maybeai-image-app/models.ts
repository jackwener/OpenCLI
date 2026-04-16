import { cli, Strategy } from '@jackwener/opencli/registry';
import { API_ARGS, maybeAiAppGet } from './common.js';

cli({
  site: 'maybeai-image-app',
  name: 'models',
  description: 'Show MaybeAI image model priority and supported aspect ratios from the API',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'model', positional: true, required: false, help: 'Optional model id' },
    ...API_ARGS,
  ],
  func: async (_page, kwargs) => {
    const model = typeof kwargs.model === 'string' ? kwargs.model : undefined;
    return maybeAiAppGet(model ? `/api/v1/image-app/models/${model}` : '/api/v1/image-app/models', kwargs);
  },
});
