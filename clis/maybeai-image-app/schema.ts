import { cli, Strategy } from '@jackwener/opencli/registry';
import { getMaybeAiGeneratedImageApp } from './catalog.js';
import { getMaybeAiOptions } from './profiles.js';
import { inferMaybeAiImageKind } from './resolver.js';

cli({
  site: 'maybeai-image-app',
  name: 'schema',
  description: 'Show unified CLI schema and backend variable mapping for a MaybeAI generated-image app',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'app', positional: true, required: true, help: 'MaybeAI app id, e.g. change-model' },
  ],
  func: async (_page, kwargs) => {
    const app = getMaybeAiGeneratedImageApp(String(kwargs.app));
    return {
      id: app.id,
      title: app.title,
      group: app.group,
      summary: app.summary,
      sourceRef: app.sourceRef,
      defaultImageKind: inferMaybeAiImageKind(app.id),
      inputSchema: app.fields,
      outputSchema: app.output,
      options: getMaybeAiOptions(),
    };
  },
});
