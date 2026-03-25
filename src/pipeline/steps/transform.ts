/**
 * Pipeline steps: data transforms — select, map, filter, sort, limit.
 */

import type { IPage } from '../../types.js';
import { render, evalExpr } from '../template.js';

import { isRecord } from '../../utils.js';

export async function stepSelect(_page: IPage | null, params: unknown, data: unknown, args: Record<string, unknown>): Promise<unknown> {
  const pathStr = String(render(params, { args, data }));
  if (data && typeof data === 'object') {
    let current: unknown = data;
    for (const part of pathStr.split('.')) {
      if (isRecord(current)) current = current[part];
      else if (Array.isArray(current) && /^\d+$/.test(part)) current = current[parseInt(part, 10)];
      else return null;
    }
    return current;
  }
  return data;
}

export async function stepMap(_page: IPage | null, params: unknown, data: unknown, args: Record<string, unknown>): Promise<unknown> {
  if (!data || typeof data !== 'object') return data;
  let source: unknown = data;

  // Support inline select: { map: { select: 'path', key: '${{ item.x }}' } }
  if (isRecord(params) && 'select' in params) {
    source = await stepSelect(null, params.select, data, args);
  }

  if (!source || typeof source !== 'object') return source;

  let items: unknown[] = Array.isArray(source) ? source : [source];
  if (isRecord(source) && Array.isArray(source.data)) items = source.data;
  const result: Array<Record<string, unknown>> = [];
  const templateParams = isRecord(params) ? params : {};
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const row: Record<string, unknown> = {};
    for (const [key, template] of Object.entries(templateParams)) {
      if (key === 'select') continue;
      row[key] = render(template, { args, data: source, item, index: i });
    }
    result.push(row);
  }
  return result;
}

export async function stepFilter(_page: IPage | null, params: unknown, data: unknown, args: Record<string, unknown>): Promise<unknown> {
  if (!Array.isArray(data)) return data;
  return data.filter((item, i) => evalExpr(String(params), { args, item, index: i }));
}

export async function stepSort(_page: IPage | null, params: unknown, data: unknown, _args: Record<string, unknown>): Promise<unknown> {
  if (!Array.isArray(data)) return data;
  const key = isRecord(params) ? String(params.by ?? '') : String(params);
  const reverse = isRecord(params) ? params.order === 'desc' : false;
  return [...data].sort((a, b) => {
    const left = isRecord(a) ? a[key] : undefined;
    const right = isRecord(b) ? b[key] : undefined;
    const cmp = String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true });
    return reverse ? -cmp : cmp;
  });
}

export async function stepLimit(_page: IPage | null, params: unknown, data: unknown, args: Record<string, unknown>): Promise<unknown> {
  if (!Array.isArray(data)) return data;
  return data.slice(0, Number(render(params, { args, data })));
}
