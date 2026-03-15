/**
 * Pipeline steps: data transforms — select, map, filter, sort, limit.
 */

import { render, evalExpr } from '../template.js';

export async function stepSelect(_page: any, params: any, data: any, args: Record<string, any>): Promise<any> {
  const pathStr = String(render(params, { args, data }));
  if (data && typeof data === 'object') {
    let current = data;
    for (const part of pathStr.split('.')) {
      if (current && typeof current === 'object' && !Array.isArray(current)) current = (current as any)[part];
      else if (Array.isArray(current) && /^\d+$/.test(part)) current = current[parseInt(part, 10)];
      else return null;
    }
    return current;
  }
  return data;
}

export async function stepMap(_page: any, params: any, data: any, args: Record<string, any>): Promise<any> {
  if (!data || typeof data !== 'object') return data;
  let items: any[] = Array.isArray(data) ? data : [data];
  if (!Array.isArray(data) && typeof data === 'object' && 'data' in data) items = data.data;
  const result: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const row: Record<string, any> = {};
    for (const [key, template] of Object.entries(params)) row[key] = render(template, { args, data, item, index: i });
    result.push(row);
  }
  return result;
}

export async function stepFilter(_page: any, params: any, data: any, args: Record<string, any>): Promise<any> {
  if (!Array.isArray(data)) return data;
  return data.filter((item, i) => evalExpr(String(params), { args, item, index: i }));
}

export async function stepSort(_page: any, params: any, data: any, _args: Record<string, any>): Promise<any> {
  if (!Array.isArray(data)) return data;
  const key = typeof params === 'object' ? (params.by ?? '') : String(params);
  const reverse = typeof params === 'object' ? params.order === 'desc' : false;
  return [...data].sort((a, b) => { const va = a[key] ?? ''; const vb = b[key] ?? ''; const cmp = va < vb ? -1 : va > vb ? 1 : 0; return reverse ? -cmp : cmp; });
}

export async function stepLimit(_page: any, params: any, data: any, args: Record<string, any>): Promise<any> {
  if (!Array.isArray(data)) return data;
  return data.slice(0, Number(render(params, { args, data })));
}
