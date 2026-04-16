import { cli, Strategy } from '@jackwener/opencli/registry';
import { API_ARGS, INPUT_ARGS, buildAppBody, maybeAiAppPost } from './common.js';

cli({
  site: 'maybeai-image-app',
  name: 'resolve',
  description: 'Resolve MaybeAI image app defaults and platform/model rules through the API',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'app', positional: true, required: true, help: 'MaybeAI app id, e.g. gen-main' },
    ...INPUT_ARGS,
    ...API_ARGS,
  ],
  func: async (_page, kwargs) => maybeAiAppPost('/api/v1/image-app/resolve', buildAppBody(String(kwargs.app), kwargs), kwargs),
});
