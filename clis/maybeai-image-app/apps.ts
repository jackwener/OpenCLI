import { cli, Strategy } from '@jackwener/opencli/registry';
import { listMaybeAiGeneratedImageApps } from './catalog.js';
import { inferMaybeAiImageKind } from './resolver.js';

cli({
  site: 'maybeai-image-app',
  name: 'apps',
  description: 'List normalized MaybeAI generated-image apps and their unified CLI fields',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['group', 'app', 'kind', 'title', 'inputs', 'output'],
  func: async () => {
    return listMaybeAiGeneratedImageApps().map((app) => ({
      group: app.group,
      app: app.id,
      kind: inferMaybeAiImageKind(app.id),
      title: app.title,
      inputs: app.fields.map((field) => field.key).join(', '),
      output: app.output.multiple ? 'images[]' : 'image',
    }));
  },
});
