import { cli, Strategy } from '@jackwener/opencli/registry';
import { getApp } from './catalog.js';
import { getOptions } from './profiles.js';
import { inferImageKind } from './resolver.js';

cli({
  site: 'maybeai-image-app',
  name: 'schema',
  description: 'Show local unified input schema and backend variable mapping for a MaybeAI image app',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'app', positional: true, required: true, help: 'MaybeAI app id, e.g. gen-main' },
  ],
  func: async (_page, kwargs) => {
    const app = getApp(String(kwargs.app));
    return {
      id: app.id,
      title: app.title,
      group: app.group,
      summary: app.summary,
      sourceRef: app.sourceRef,
      defaultImageKind: inferImageKind(app.id),
      inputSchema: app.fields,
      outputSchema: app.output,
      options: getOptions(),
    };
  },
});
