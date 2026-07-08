/**
 * Pipeline executor: runs YAML pipeline steps sequentially.
 */


import type { IPage } from '../types.js';
import { getStep, type StepHandler } from './registry.js';
import { log } from '../logger.js';
import { ConfigError } from '../errors.js';
import { BROWSER_ONLY_STEPS } from '../capabilityRouting.js';
import { isTransientBrowserError } from '../browser/errors.js';

export interface PipelineContext {
  args?: Record<string, unknown>;
  debug?: boolean;
  /** Max retry attempts per step (default: 2 for browser steps, 0 for others) */
  stepRetries?: number;
}

export async function executePipeline(
  page: IPage | null,
  pipeline: unknown[],
  ctx: PipelineContext = {},
): Promise<unknown> {
  const args = ctx.args ?? {};
  const debug = ctx.debug ?? false;
  let data: unknown = null;
  const total = pipeline.length;

  try {
    for (let i = 0; i < pipeline.length; i++) {
      const step = pipeline[i];
      if (!step || typeof step !== 'object') continue;
      for (const [op, params] of Object.entries(step)) {
        if (debug) debugStepStart(i + 1, total, op, params);

        const handler = getStep(op);
        if (handler) {
          data = await executeStepWithRetry(handler, page, params, data, args, op, ctx.stepRetries);
        } else {
          throw new ConfigError(
            `Unknown pipeline step "${op}" at index ${i}.`,
            'Check the YAML pipeline step name or register the custom step before execution.',
          );
        }

        if (debug) debugStepResult(op, data);
      }
    }
  } catch (err) {
    // Attempt cleanup: release automation tab lease on pipeline failure.
    if (page?.closeWindow) {
      try { await page.closeWindow(); } catch { /* ignore */ }
    }
    throw err;
  }
  return data;
}

async function executeStepWithRetry(
  handler: StepHandler,
  page: IPage | null,
  params: unknown,
  data: unknown,
  args: Record<string, unknown>,
  op: string,
  configRetries?: number,
): Promise<unknown> {
  const maxRetries = configRetries ?? (BROWSER_ONLY_STEPS.has(op) ? 2 : 0);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await handler(page, params, data, args);
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      // Only retry on transient browser errors
      if (!isTransientBrowserError(err)) throw err;
      // Brief delay before retry
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  // Unreachable
  throw new Error(`Step "${op}" failed after ${maxRetries} retries`);
}

function debugStepStart(stepNum: number, total: number, op: string, params: unknown): void {
  let preview = '';
  if (typeof params === 'string') {
    preview = params.length <= 80 ? ` → ${params}` : ` → ${params.slice(0, 77)}...`;
  } else if (params && typeof params === 'object' && !Array.isArray(params)) {
    preview = ` (${Object.keys(params).join(', ')})`;
  }
  log.step(stepNum, total, op, preview);
}

function debugStepResult(op: string, data: unknown): void {
  if (data === null || data === undefined) {
    log.stepResult('(no data)');
  } else if (Array.isArray(data)) {
    log.stepResult(`${data.length} items`);
  } else if (typeof data === 'object') {
    const keys = Object.keys(data).slice(0, 5);
    log.stepResult(`dict (${keys.join(', ')}${Object.keys(data).length > 5 ? '...' : ''})`);
  } else if (typeof data === 'string') {
    const p = data.slice(0, 60).replace(/\n/g, '\\n');
    log.stepResult(`"${p}${data.length > 60 ? '...' : ''}"`);
  } else {
    log.stepResult(`${typeof data}`);
  }
}
