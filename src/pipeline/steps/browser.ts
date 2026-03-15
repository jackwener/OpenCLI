/**
 * Pipeline step: navigate, click, type, wait, press, snapshot.
 * Browser interaction primitives.
 */

import type { IPage } from '../../types.js';
import { render, normalizeEvaluateSource } from '../template.js';

export async function stepNavigate(page: IPage, params: any, data: any, args: Record<string, any>): Promise<any> {
  const url = render(params, { args, data });
  await page.goto(String(url));
  return data;
}

export async function stepClick(page: IPage, params: any, data: any, args: Record<string, any>): Promise<any> {
  await page.click(String(render(params, { args, data })).replace(/^@/, ''));
  return data;
}

export async function stepType(page: IPage, params: any, data: any, args: Record<string, any>): Promise<any> {
  if (typeof params === 'object' && params) {
    const ref = String(render(params.ref ?? '', { args, data })).replace(/^@/, '');
    const text = String(render(params.text ?? '', { args, data }));
    await page.typeText(ref, text);
    if (params.submit) await page.pressKey('Enter');
  }
  return data;
}

export async function stepWait(page: IPage, params: any, data: any, args: Record<string, any>): Promise<any> {
  if (typeof params === 'number') await page.wait(params);
  else if (typeof params === 'object' && params) {
    if ('text' in params) {
      const timeout = params.timeout ?? 10;
      const start = Date.now();
      while ((Date.now() - start) / 1000 < timeout) {
        const snap = await page.snapshot({ raw: true });
        if (typeof snap === 'string' && snap.includes(params.text)) break;
        await page.wait(0.5);
      }
    } else if ('time' in params) await page.wait(Number(params.time));
  } else if (typeof params === 'string') await page.wait(Number(render(params, { args, data })));
  return data;
}

export async function stepPress(page: IPage, params: any, data: any, args: Record<string, any>): Promise<any> {
  await page.pressKey(String(render(params, { args, data })));
  return data;
}

export async function stepSnapshot(page: IPage, params: any, _data: any, _args: Record<string, any>): Promise<any> {
  const opts = (typeof params === 'object' && params) ? params : {};
  return page.snapshot({ interactive: opts.interactive ?? false, compact: opts.compact ?? false, maxDepth: opts.max_depth, raw: opts.raw ?? false });
}

export async function stepEvaluate(page: IPage, params: any, data: any, args: Record<string, any>): Promise<any> {
  const js = String(render(params, { args, data }));
  let result = await page.evaluate(normalizeEvaluateSource(js));
  // MCP may return JSON as a string — auto-parse it
  if (typeof result === 'string') {
    const trimmed = result.trim();
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try { result = JSON.parse(trimmed); } catch {}
    }
  }
  return result;
}
