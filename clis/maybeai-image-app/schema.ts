import { cli, Strategy } from '@jackwener/opencli/registry';
import { API_ARGS, maybeAiAppGet } from './common.js';

cli({
  site: 'maybeai-image-app',
  name: 'schema',
  description: 'Show unified input schema and backend variable mapping for a MaybeAI image app',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'app', positional: true, required: true, help: 'MaybeAI app id, e.g. gen-main' },
    ...API_ARGS,
  ],
  func: async (_page, kwargs) => maybeAiAppGet(`/api/v1/image-app/schema/${encodeURIComponent(String(kwargs.app))}`, kwargs),
});
