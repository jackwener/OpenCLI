import type { CliCommand } from './registry.js';

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
  // normalizeCommand sets navigateBefore to a URL string (needs pre-nav) or
  // boolean true (needs authenticated context, no specific URL). Either way
  // the pipeline requires a browser session even if no step is browser-only.
  if (cmd.navigateBefore) return true;
  return pipelineNeedsBrowserSession(cmd.pipeline as Record<string, unknown>[]);
}
