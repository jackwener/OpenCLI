import { cli, Strategy } from '@jackwener/opencli/registry';
import { INPUT_ARGS } from '../maybeai/shared/options.js';
import { buildVideoAppPlan, RUN_EXTRA_ARGS } from './planner.js';

cli({
  site: 'maybeai-video-app',
  name: 'select',
  access: 'read',
  description: 'Select the best MaybeAI video app and compose normalized input locally',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'intent', positional: true, required: false, help: 'Natural language intent, e.g. 给这个商品生成一条短视频' },
    ...INPUT_ARGS,
    ...RUN_EXTRA_ARGS,
  ],
  func: async (_page, kwargs) => buildVideoAppPlan([String(kwargs.intent ?? '')], kwargs),
});
