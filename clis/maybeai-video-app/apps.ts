import { cli, Strategy } from '@jackwener/opencli/registry';
import { listApps } from './catalog.js';

cli({
  site: 'maybeai-video-app',
  name: 'apps',
  access: 'read',
  description: 'List local MaybeAI video apps available in opencli',
  strategy: Strategy.PUBLIC,
  browser: false,
  columns: ['group', 'app', 'title', 'inputs', 'output'],
  func: async () =>
    listApps().map(app => ({
      group: app.group,
      app: app.id,
      title: app.title,
      inputs: app.fields.map(field => field.key),
      output: app.output.multiple ? 'videos[]' : 'video',
    })),
});
