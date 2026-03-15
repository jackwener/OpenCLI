/**
 * Pipeline executor: runs YAML pipeline steps sequentially.
 */

import chalk from 'chalk';
import type { IPage } from '../types.js';
import { stepNavigate, stepClick, stepType, stepWait, stepPress, stepSnapshot, stepEvaluate } from './steps/browser.js';
import { stepFetch } from './steps/fetch.js';
import { stepSelect, stepMap, stepFilter, stepSort, stepLimit } from './steps/transform.js';
import { stepIntercept } from './steps/intercept.js';
import { stepTap } from './steps/tap.js';

export interface PipelineContext {
  args?: Record<string, any>;
  debug?: boolean;
}

/** Step handler signature */
type StepHandler = (page: IPage | null, params: any, data: any, args: Record<string, any>) => Promise<any>;

/** Registry of all available step handlers */
const STEP_HANDLERS: Record<string, StepHandler> = {
  navigate: stepNavigate as StepHandler,
  fetch: stepFetch,
  select: stepSelect as StepHandler,
  evaluate: stepEvaluate as StepHandler,
  snapshot: stepSnapshot as StepHandler,
  click: stepClick as StepHandler,
  type: stepType as StepHandler,
  wait: stepWait as StepHandler,
  press: stepPress as StepHandler,
  map: stepMap as StepHandler,
  filter: stepFilter as StepHandler,
  sort: stepSort as StepHandler,
  limit: stepLimit as StepHandler,
  intercept: stepIntercept as StepHandler,
  tap: stepTap as StepHandler,
};

export async function executePipeline(
  page: IPage | null,
  pipeline: any[],
  ctx: PipelineContext = {},
): Promise<any> {
  const args = ctx.args ?? {};
  const debug = ctx.debug ?? false;
  let data: any = null;
  const total = pipeline.length;

  for (let i = 0; i < pipeline.length; i++) {
    const step = pipeline[i];
    if (!step || typeof step !== 'object') continue;
    for (const [op, params] of Object.entries(step)) {
      if (debug) debugStepStart(i + 1, total, op, params);

      const handler = STEP_HANDLERS[op];
      if (handler) {
        data = await handler(page, params, data, args);
      } else {
        if (debug) process.stderr.write(`  ${chalk.yellow('⚠')}  Unknown step: ${op}\n`);
      }

      // Detect error objects returned by steps (e.g. tap store not found)
      if (data && typeof data === 'object' && !Array.isArray(data) && data.error) {
        process.stderr.write(`  ${chalk.yellow('⚠')}  ${chalk.yellow(op)}: ${data.error}\n`);
        if (data.hint) process.stderr.write(`  ${chalk.dim('💡')} ${chalk.dim(data.hint)}\n`);
      }
      if (debug) debugStepResult(op, data);
    }
  }
  return data;
}

function debugStepStart(stepNum: number, total: number, op: string, params: any): void {
  let preview = '';
  if (typeof params === 'string') {
    preview = params.length <= 80 ? ` → ${params}` : ` → ${params.slice(0, 77)}...`;
  } else if (params && typeof params === 'object' && !Array.isArray(params)) {
    preview = ` (${Object.keys(params).join(', ')})`;
  }
  process.stderr.write(`  ${chalk.dim(`[${stepNum}/${total}]`)} ${chalk.bold.cyan(op)}${preview}\n`);
}

function debugStepResult(op: string, data: any): void {
  if (data === null || data === undefined) {
    process.stderr.write(`       ${chalk.dim('→ (no data)')}\n`);
  } else if (Array.isArray(data)) {
    process.stderr.write(`       ${chalk.dim(`→ ${data.length} items`)}\n`);
  } else if (typeof data === 'object') {
    const keys = Object.keys(data).slice(0, 5);
    process.stderr.write(`       ${chalk.dim(`→ dict (${keys.join(', ')}${Object.keys(data).length > 5 ? '...' : ''})`)}\n`);
  } else if (typeof data === 'string') {
    const p = data.slice(0, 60).replace(/\n/g, '\\n');
    process.stderr.write(`       ${chalk.dim(`→ "${p}${data.length > 60 ? '...' : ''}"`)}\n`);
  } else {
    process.stderr.write(`       ${chalk.dim(`→ ${typeof data}`)}\n`);
  }
}
