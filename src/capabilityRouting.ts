import type { CliCommand } from './registry.js';
import { getRegisteredStepNames } from './pipeline/registry.js';

/**
 * Pipeline steps that require a live browser session.
 *
 * Note: this is the *subset* of registered pipeline steps that need a page;
 * non-browser steps (fetch, select, map, filter, sort, limit, download)
 * deliberately stay out. The full registered-step list lives in
 * `src/pipeline/registry.ts` and is re-derived elsewhere via
 * `getRegisteredStepNames()` (e.g. in `validate.ts`). When you add a new
 * pipeline step, decide whether it belongs here based on whether its handler
 * touches the IPage object — and `src/capabilityRouting.test.ts` verifies the
 * subset relationship is intact.
 */
export const BROWSER_ONLY_STEPS = new Set([
  'navigate',
  'click',
  'type',
  'fill',
  'wait',
  'press',
  'snapshot',
  'evaluate',
  'intercept',
  'tap',
]);

/** Internal helper: ensure BROWSER_ONLY_STEPS is a subset of registered pipeline steps. */
export function _validateBrowserOnlyStepsAgainstRegistry(): { extras: string[] } {
  const registered = new Set(getRegisteredStepNames());
  const extras: string[] = [];
  for (const step of BROWSER_ONLY_STEPS) {
    if (!registered.has(step)) extras.push(step);
  }
  return { extras };
}

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
