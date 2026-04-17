import { cli, Strategy } from '@jackwener/opencli/registry';
import { listApps } from './catalog.js';
import { inferImageKind } from './resolver.js';

cli({
  site: 'maybeai-image-app',
  name: 'apps',
  description: 'List local MaybeAI image apps available in opencli',
  strategy: Strategy.PUBLIC,
  browser: false,
  columns: ['group', 'app', 'kind', 'title', 'inputs', 'output'],
  func: async () =>
    listApps().map(app => ({
      group: app.group,
      app: app.id,
      kind: inferImageKind(app.id),
      title: app.title,
      inputs: app.fields.map(field => field.key),
      output: app.output.multiple ? 'images[]' : 'image',
    })),
});
