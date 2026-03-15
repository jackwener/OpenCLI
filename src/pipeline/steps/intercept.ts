/**
 * Pipeline step: intercept — declarative XHR interception.
 */

import type { IPage } from '../../types.js';
import { render } from '../template.js';

export async function stepIntercept(page: IPage, params: any, data: any, args: Record<string, any>): Promise<any> {
  const cfg = typeof params === 'object' ? params : {};
  const trigger = cfg.trigger ?? '';
  const capturePattern = cfg.capture ?? '';
  const timeout = cfg.timeout ?? 8;
  const selectPath = cfg.select ?? null;

  if (!capturePattern) return data;

  // Step 1: Execute the trigger action
  if (trigger.startsWith('navigate:')) {
    const url = render(trigger.slice('navigate:'.length), { args, data });
    await page.goto(String(url));
  } else if (trigger.startsWith('evaluate:')) {
    const js = trigger.slice('evaluate:'.length);
    const { normalizeEvaluateSource } = await import('../template.js');
    await page.evaluate(normalizeEvaluateSource(render(js, { args, data }) as string));
  } else if (trigger.startsWith('click:')) {
    const ref = render(trigger.slice('click:'.length), { args, data });
    await page.click(String(ref).replace(/^@/, ''));
  } else if (trigger === 'scroll') {
    await page.scroll('down');
  }

  // Step 2: Wait a bit for network requests to fire
  await page.wait(Math.min(timeout, 3));

  // Step 3: Get network requests and find matching ones
  const rawNetwork = await page.networkRequests(false);
  const matchingResponses: any[] = [];

  if (typeof rawNetwork === 'string') {
    const lines = rawNetwork.split('\n');
    for (const line of lines) {
      const match = line.match(/\[?(GET|POST)\]?\s+(\S+)\s*(?:=>|→)\s*\[?(\d+)\]?/i);
      if (match) {
        const [, , url, status] = match;
        if (url.includes(capturePattern) && status === '200') {
          try {
            const body = await page.evaluate(`
              async () => {
                try {
                  const resp = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
                  if (!resp.ok) return null;
                  return await resp.json();
                } catch { return null; }
              }
            `);
            if (body) matchingResponses.push(body);
          } catch {}
        }
      }
    }
  }

  // Step 4: Select from response if specified
  let result = matchingResponses.length === 1 ? matchingResponses[0] :
               matchingResponses.length > 1 ? matchingResponses : data;

  if (selectPath && result) {
    let current = result;
    for (const part of String(selectPath).split('.')) {
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        current = current[part];
      } else break;
    }
    result = current ?? result;
  }

  return result;
}
