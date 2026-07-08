import { cli, Strategy } from '@jackwener/opencli/registry';
import { INPUT_ARGS, readJsonObjectInput } from './common.js';
import { resolveImageAppInput } from './resolver.js';

cli({
  site: 'maybeai-image-app',
  name: 'payload',
  access: 'read',
  description: 'Build local workflow variables for a MaybeAI image app',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'app', positional: true, required: true, help: 'MaybeAI app id, e.g. gen-main' },
    ...INPUT_ARGS,
  ],
  func: async (_page, kwargs) => {
    const resolved = resolveImageAppInput(String(kwargs.app), readJsonObjectInput(kwargs));
    return {
      app: resolved.app,
      title: resolved.title,
      input: resolved.input,
      variables: resolved.variables,
      outputSchema: resolved.outputSchema,
    };
  },
});
