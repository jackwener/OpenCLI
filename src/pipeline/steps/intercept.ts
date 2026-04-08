/**
 * Pipeline step: intercept — declarative XHR interception.
 */

import type { IPage } from '../../types.js';
import { render, normalizeEvaluateSource } from '../template.js';

interface InterceptParams {
  trigger?: string;
  capture?: string;
  timeout?: number;
  select?: string;
}

export async function stepIntercept(
  page: IPage | null,
  params: unknown,
  data: unknown,
  args: Record<string, unknown>,
): Promise<unknown> {
  const cfg: InterceptParams = typeof params === 'object' && params !== null ? (params as InterceptParams) : {};
  const trigger = cfg.trigger ?? '';
  const capturePattern = cfg.capture ?? '';
  const timeout = cfg.timeout ?? 8;
  const selectPath = cfg.select ?? null;

  if (!capturePattern) return data;

  // Step 1: Inject fetch/XHR interceptor BEFORE trigger
  await page!.installInterceptor(capturePattern);

  // Step 2: Execute the trigger action
  if (trigger.startsWith('navigate:')) {
    const url = render(trigger.slice('navigate:'.length), { args, data });
    await page!.goto(String(url));
  } else if (trigger.startsWith('evaluate:')) {
    const js = trigger.slice('evaluate:'.length);
    await page!.evaluate(normalizeEvaluateSource(render(js, { args, data }) as string));
  } else if (trigger.startsWith('click:')) {
    const ref = render(trigger.slice('click:'.length), { args, data });
    await page!.click(String(ref).replace(/^@/, ''));
  } else if (trigger === 'scroll') {
    await page!.scroll('down');
  }

  // Step 3: Wait for network capture (event-driven, not fixed sleep)
  await page!.waitForCapture(timeout);

  // Step 4: Retrieve captured data
  const matchingResponses = await page!.getInterceptedRequests();

  // Step 5: Select from response if specified
  let result: unknown = matchingResponses.length === 1 ? matchingResponses[0] :
               matchingResponses.length > 1 ? matchingResponses : data;

  if (selectPath && result) {
    let current: unknown = result;
    for (const part of String(selectPath).split('.')) {
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        current = (current as Record<string, unknown>)[part];
      } else break;
    }
    result = current ?? result;
  }

  return result;
}
