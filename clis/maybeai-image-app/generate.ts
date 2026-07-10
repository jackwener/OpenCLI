import { cli, Strategy } from '@jackwener/opencli/registry';
import { addGenerateOptions, INPUT_ARGS, readJsonObjectInput, WORKFLOW_ARGS } from './common.js';
import { executeGenerate } from './engine.js';
import { runGenReference } from './gen-reference-runner.js';
import { runGenImageSet } from './gen-image-set-runner.js';
import { runReplicaListingImage } from './replica-listing-runner.js';

cli({
  site: 'maybeai-image-app',
  name: 'generate',
  access: 'write',
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
  func: async (_page, kwargs) => {
    const app = String(kwargs.app);
    const input = addGenerateOptions({ input: readJsonObjectInput(kwargs) }, kwargs).input as Record<string, unknown>;
    if (app === 'gen-reference') return runGenReference(input, kwargs);
    if (app === 'gen-image-set') return runGenImageSet(input, kwargs);
    if (app === 'replica-listing-image') return runReplicaListingImage(input, kwargs);
    return executeGenerate(app, input, kwargs, !!kwargs.debug);
  },
});
