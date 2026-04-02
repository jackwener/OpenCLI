/**
 * Pipeline step: stream-intercept — declarative streaming response capture.
 *
 * Unlike `intercept` (which awaits full JSON), this reads the response body
 * as a ReadableStream and accumulates chunks incrementally. Ideal for SSE /
 * streaming endpoints where the response never terminates during use, and
 * works in background tabs where rAF is throttled but fetch streams are not.
 *
 * YAML usage:
 *   - stream-intercept:
 *       capture: "generativelanguage.googleapis.com"
 *       trigger: "click:@42"
 *       timeout: 60
 *       waitForDone: true
 *       returnEvents: false
 */

import type { IPage } from '../../types.js';
import { render, normalizeEvaluateSource } from '../template.js';

export async function stepStreamIntercept(
  page: IPage | null, params: any, data: any, args: Record<string, any>,
): Promise<any> {
  const cfg = typeof params === 'object' ? params : {};
  const trigger = cfg.trigger ?? '';
  const capturePattern = cfg.capture ?? '';
  const timeout = cfg.timeout ?? 60;
  const waitForDone = cfg.waitForDone ?? true;
  const returnEvents = cfg.returnEvents ?? false;

  if (!capturePattern || !page) return data;

  // Step 1: Install streaming interceptor BEFORE trigger
  await page.installStreamingInterceptor(capturePattern);

  // Step 2: Execute the trigger action
  if (trigger.startsWith('navigate:')) {
    const url = render(trigger.slice('navigate:'.length), { args, data });
    await page.goto(String(url));
  } else if (trigger.startsWith('evaluate:')) {
    const js = trigger.slice('evaluate:'.length);
    await page.evaluate(normalizeEvaluateSource(render(js, { args, data }) as string));
  } else if (trigger.startsWith('click:')) {
    const ref = render(trigger.slice('click:'.length), { args, data });
    await page.click(String(ref).replace(/^@/, ''));
  } else if (trigger === 'scroll') {
    await page.scroll('down');
  }

  // Step 3: Wait for streaming data
  await page.waitForStreamCapture(timeout, { waitForDone });

  // Step 4: Read accumulated data
  const result = await page.getStreamedResponses();

  if (returnEvents && result.events.length > 0) {
    return result.events;
  }
  return result.text;
}
