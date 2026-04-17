import { cli, Strategy } from '@jackwener/opencli/registry';
import { INPUT_ARGS, readJsonObjectInput } from './common.js';
import { resolveImageAppInput } from './resolver.js';

cli({
  site: 'maybeai-image-app',
  name: 'resolve',
  description: 'Resolve local MaybeAI image app defaults and platform/model rules',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'app', positional: true, required: true, help: 'MaybeAI app id, e.g. gen-main' },
    ...INPUT_ARGS,
  ],
  func: async (_page, kwargs) => resolveImageAppInput(String(kwargs.app), readJsonObjectInput(kwargs)),
});
