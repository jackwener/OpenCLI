/**
 * Dynamic registry for pipeline steps.
 * Allows core and third-party plugins to register custom YAML operations.
 */

import type { IPage } from '../types.js';

// Import core steps
import { stepNavigate, stepClick, stepType, stepWait, stepPress, stepSnapshot, stepEvaluate } from './steps/browser.js';
import { stepFetch } from './steps/fetch.js';
import { stepSelect, stepMap, stepFilter, stepSort, stepLimit } from './steps/transform.js';
import { stepIntercept } from './steps/intercept.js';
import { stepTap } from './steps/tap.js';
import { stepDownload } from './steps/download.js';

/** 
 * Step handler: all pipeline steps conform to this generic interface.
 * TData is the type of the `data` state flowing into the step.
 * TResult is the expected return type.
 */
export type StepHandler<TData = any, TResult = any> = (
  page: IPage | null,
  params: any,
  data: TData,
  args: Record<string, any>
) => Promise<TResult>;

const _stepRegistry = new Map<string, StepHandler>();

/**
 * Get a registered step handler by name.
 */
export function getStep(name: string): StepHandler | undefined {
  return _stepRegistry.get(name);
}

/**
 * Register a new custom step handler for the YAML pipeline.
 */
export function registerStep(name: string, handler: StepHandler): void {
  _stepRegistry.set(name, handler);
}

// -------------------------------------------------------------
// Auto-Register Core Steps
// -------------------------------------------------------------
registerStep('navigate', stepNavigate);
registerStep('fetch', stepFetch);
registerStep('select', stepSelect);
registerStep('evaluate', stepEvaluate);
registerStep('snapshot', stepSnapshot);
registerStep('click', stepClick);
registerStep('type', stepType);
registerStep('wait', stepWait);
registerStep('press', stepPress);
registerStep('map', stepMap);
registerStep('filter', stepFilter);
registerStep('sort', stepSort);
registerStep('limit', stepLimit);
registerStep('intercept', stepIntercept);
registerStep('tap', stepTap);
registerStep('download', stepDownload);
