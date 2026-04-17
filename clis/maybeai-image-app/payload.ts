import { cli, Strategy } from '@jackwener/opencli/registry';
import { getApp, toWorkflowVariables } from './catalog.js';
import { INPUT_ARGS, readJsonObjectInput } from './common.js';

cli({
  site: 'maybeai-image-app',
  name: 'payload',
  description: 'Build local workflow variables for a MaybeAI image app',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'app', positional: true, required: true, help: 'MaybeAI app id, e.g. gen-main' },
    ...INPUT_ARGS,
  ],
  func: async (_page, kwargs) => {
    const app = getApp(String(kwargs.app));
    return {
      app: app.id,
      title: app.title,
      variables: toWorkflowVariables(app, readJsonObjectInput(kwargs)),
      outputSchema: app.output,
    };
  },
});
