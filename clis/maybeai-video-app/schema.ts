import { cli, Strategy } from '@jackwener/opencli/registry';
import { getApp } from './catalog.js';
import { getOptions } from './profiles.js';

cli({
  site: 'maybeai-video-app',
  name: 'schema',
  access: 'read',
  description: 'Show local unified input schema and workflow output mapping for a MaybeAI video app',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'app', positional: true, required: true, help: 'MaybeAI video app id, e.g. product-ad-video' },
  ],
  func: async (_page, kwargs) => {
    const app = getApp(String(kwargs.app));
    return {
      id: app.id,
      title: app.title,
      group: app.group,
      summary: app.summary,
      sourceRef: app.sourceRef,
      inputSchema: app.fields,
      outputSchema: app.output,
      options: getOptions(),
    };
  },
});
