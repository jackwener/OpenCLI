import { cli, Strategy } from '@jackwener/opencli/registry';
import { INPUT_ARGS } from './common.js';
import { buildImageAppPlan, RUN_EXTRA_ARGS } from './planner.js';

cli({
  site: 'maybeai-image-app',
  name: 'select',
  description: 'Select the best MaybeAI image app and compose normalized input locally',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'intent', positional: true, required: false, help: 'Natural language intent, e.g. 帮我换模特' },
    ...INPUT_ARGS,
    ...RUN_EXTRA_ARGS,
  ],
  func: async (_page, kwargs) => buildImageAppPlan([String(kwargs.intent ?? '')], kwargs),
});
