import { cli, Strategy } from '@jackwener/opencli/registry';
import { API_ARGS, maybeAiAppGet } from './common.js';

cli({
  site: 'maybeai-image-app',
  name: 'apps',
  description: 'List MaybeAI image apps available through the MaybeAI app API',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [...API_ARGS],
  columns: ['group', 'app', 'kind', 'title', 'inputs', 'output'],
  func: async (_page, kwargs) => maybeAiAppGet('/api/v1/image-app/apps', kwargs),
});
