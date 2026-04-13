import { Strategy, type CliCommand } from './registry.js';

/** Pipeline steps that require a live browser session. */
export const BROWSER_ONLY_STEPS = new Set([
  'navigate',
  'click',
  'type',
  'wait',
  'press',
  'snapshot',
  'evaluate',
  'intercept',
  'tap',
  'open-user-tab',
]);

function pipelineNeedsBrowserSession(pipeline: Record<string, unknown>[]): boolean {
  return pipeline.some((step) => {
    if (!step || typeof step !== 'object') return false;
    return Object.keys(step).some((op) => BROWSER_ONLY_STEPS.has(op));
  });
}

export function shouldUseBrowserSession(cmd: CliCommand): boolean {
  if (!cmd.browser) return false;
  if (cmd.func) return true;
  if (!cmd.pipeline || cmd.pipeline.length === 0) return true;
  if (cmd.strategy !== Strategy.PUBLIC) return true;
  return pipelineNeedsBrowserSession(cmd.pipeline as Record<string, unknown>[]);
}
