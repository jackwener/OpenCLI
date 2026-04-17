import { cli, Strategy } from '@jackwener/opencli/registry';
import { addGenerateOptions, INPUT_ARGS, readJsonObjectInput, WORKFLOW_ARGS } from './common.js';
import { executeGenerate } from './engine.js';

cli({
  site: 'maybeai-image-app',
  name: 'generate',
  description: 'Generate images with an explicit MaybeAI app and run workflows directly',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'app', positional: true, required: true, help: 'MaybeAI app id, e.g. gen-main' },
    ...INPUT_ARGS,
    { name: 'task-id', help: 'Optional workflow task id for tracing' },
    { name: 'debug', help: 'Include workflow debug details' },
    ...WORKFLOW_ARGS,
  ],
  func: async (_page, kwargs) => executeGenerate(String(kwargs.app), addGenerateOptions({ input: readJsonObjectInput(kwargs) }, kwargs).input as Record<string, unknown>, kwargs, !!kwargs.debug),
});
