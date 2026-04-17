import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { INPUT_ARGS, WORKFLOW_ARGS } from './common.js';
import { executeGenerate } from './engine.js';
import { assertRunnablePlan, buildImageAppPlan, RUN_EXTRA_ARGS } from './planner.js';

cli({
  site: 'maybeai-image-app',
  name: 'run',
  description: 'Select app and compose normalized input locally, then run workflows directly',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'intent', positional: true, required: false, help: 'Natural language intent, e.g. 给这个商品生成 Amazon 主图' },
    ...INPUT_ARGS,
    ...RUN_EXTRA_ARGS,
    { name: 'task-id', help: 'Optional workflow task id for tracing' },
    { name: 'min-confidence', help: 'Minimum confidence required to auto run, default 0.3' },
    { name: 'debug', help: 'Include workflow debug details' },
    ...WORKFLOW_ARGS,
  ],
  func: async (_page, kwargs) => {
    const plan = buildImageAppPlan([String(kwargs.intent ?? '')], kwargs);
    if (kwargs['dry-run']) return plan;
    if (plan.confidence < Number(kwargs['min-confidence'] ?? 0.3)) {
      throw new CliError(
        'ARGUMENT',
        `Low confidence app selection: ${plan.selectedApp} (${plan.confidence})`,
        `Use --app to override, or call select first. Candidates: ${plan.candidates.map(item => `${item.app}:${item.confidence}`).join(', ')}`,
      );
    }
    assertRunnablePlan(plan);
    return executeGenerate(plan.selectedApp, plan.input, kwargs, !!kwargs.debug);
  },
});
