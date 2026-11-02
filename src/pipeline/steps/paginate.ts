/** Bounded, sequential pagination for JSON APIs in Node or a browser session. */
import { ArgumentError, CliError } from '../../errors.js';
import type { IPage } from '../../types.js';
import { isRecord } from '../../utils.js';
import { render, type RenderContext } from '../template.js';
import { fetchWithContext } from './fetch.js';

export type PaginationValue = string | number | null;
export interface PaginationCheckpoint {
  value: PaginationValue;
  /** Number of raw rows to skip when replaying this page. */
  skip: number;
}
export interface PaginateResult {
  items: unknown[];
  pagination: {
    pages: number;
    fetchedItems: number;
    returnedItems: number;
    duplicateItems: number;
    skippedItems: number;
    complete: boolean;
    stopReason: 'exhausted' | 'max_pages' | 'max_items';
    resume: PaginationCheckpoint | null;
  };
}

const OPTIONS = new Set(['request', 'items', 'next', 'initial', 'skip', 'maxPages', 'maxItems', 'delayMs', 'dedupeBy', 'requireComplete']);
const REQUEST_OPTIONS = new Set(['url', 'method', 'headers', 'params', 'body']);

function integer(value: unknown, fallback: number, min: number, max: number, name: string, ctx: RenderContext): number {
  const resolved = value === undefined ? fallback : render(value, ctx);
  const number = typeof resolved === 'string' && /^\d+$/.test(resolved) ? Number(resolved) : resolved;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new ArgumentError(`Paginate ${name} must be an integer between ${min} and ${max}.`);
  }
  return number;
}

function expression(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^\s*\$\{\{[\s\S]+\}\}\s*$/.test(value)) {
    throw new ArgumentError('Paginate ' + name + ' must be a ${{ ... }} expression.');
  }
  return value;
}

function isValue(value: unknown): value is PaginationValue {
  return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value));
}

function valueKey(value: PaginationValue | boolean): string {
  return JSON.stringify([typeof value, value]);
}

function nextValue(value: unknown): PaginationValue {
  if (value === false || value === '') return null;
  if (!isValue(value)) {
    throw new CliError('PAGINATION_RESPONSE', 'Paginate next must resolve to a string, safe integer, null, or false.',
      'Check the next expression. If the API omits the final cursor, explicitly use ?? null.');
  }
  return value;
}

export async function stepPaginate(page: IPage | null, params: unknown, data: unknown, args: Record<string, unknown>): Promise<PaginateResult> {
  if (!isRecord(params)) throw new ArgumentError('Paginate requires an options object.');
  for (const key of Object.keys(params)) {
    if (!OPTIONS.has(key)) throw new ArgumentError(`Unknown paginate option: ${key}`);
  }
  if (!isRecord(params.request) || typeof params.request.url !== 'string' || !params.request.url.trim()) {
    throw new ArgumentError('Paginate request requires a non-empty url string.');
  }
  const request = params.request;
  for (const key of Object.keys(request)) {
    if (!REQUEST_OPTIONS.has(key)) throw new ArgumentError(`Unsupported paginate request option: ${key}`);
  }
  const method = request.method ?? 'GET';
  if (typeof method !== 'string' || !['GET', 'POST'].includes(method.toUpperCase())) {
    throw new ArgumentError('Paginate request method must be GET or POST for a read endpoint.');
  }
  if (method.toUpperCase() === 'GET' && 'body' in request) throw new ArgumentError('Paginate GET requests cannot have a body.');
  for (const key of ['headers', 'params']) {
    if (request[key] !== undefined && !isRecord(request[key])) throw new ArgumentError(`Paginate request ${key} must be an object.`);
  }
  const itemsExpr = expression(params.items, 'items');
  const nextExpr = expression(params.next, 'next');
  const dedupeExpr = params.dedupeBy === undefined ? undefined : expression(params.dedupeBy, 'dedupeBy');
  if (params.requireComplete !== undefined && typeof params.requireComplete !== 'boolean') {
    throw new ArgumentError('Paginate requireComplete must be a boolean.');
  }
  const initialContext = { args, data, root: data };
  const initialValue = params.initial === undefined ? null : render(params.initial, initialContext);
  if (!isValue(initialValue)) throw new ArgumentError('Paginate initial must resolve to a string, safe integer, or null.');
  let value: PaginationValue = initialValue;
  let skip = integer(params.skip, 0, 0, Number.MAX_SAFE_INTEGER, 'skip', initialContext);
  const maxPages = integer(params.maxPages, 10, 1, 1000, 'maxPages', initialContext);
  const maxItems = integer(params.maxItems, 10_000, 1, 100_000, 'maxItems', initialContext);
  const delayMs = integer(params.delayMs, 0, 0, 60_000, 'delayMs', initialContext);
  const items: unknown[] = [];
  const visited = new Set<string>();
  const seenItems = new Set<string>();
  let pages = 0;
  let fetchedItems = 0;
  let duplicateItems = 0;
  let skippedItems = 0;

  const finish = (stopReason: PaginateResult['pagination']['stopReason'], resume: PaginationCheckpoint | null): PaginateResult => {
    const complete = stopReason === 'exhausted';
    if (!complete && params.requireComplete) {
      throw new CliError('PAGINATION_LIMIT', `Pagination reached ${stopReason} after ${pages} page(s) and ${items.length} item(s).`,
        'Increase the pagination bound or disable requireComplete and inspect pagination.resume.');
    }
    return { items, pagination: { pages, fetchedItems, returnedItems: items.length, duplicateItems, skippedItems, complete, stopReason, resume } };
  };

  while (pages < maxPages) {
    // `value` is deliberately not rendered again: server cursors are data, not code.
    const currentValue: PaginationValue = value;
    visited.add(valueKey(currentValue));
    if (pages > 0 && delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
    const pagination = { value: currentValue, page: pages + 1 };
    const response = await fetchWithContext(page, request, { args, data, root: data, pagination });
    pages++;
    const context: RenderContext = { args, data: response, root: data, pagination };
    const rows = render(itemsExpr, context);
    if (!Array.isArray(rows)) {
      throw new CliError('PAGINATION_RESPONSE', `Paginate items did not resolve to an array on page ${pages}.`,
        'Check the items expression and the API response; missing data is not an empty page.');
    }
    const next = nextValue(render(nextExpr, context));
    fetchedItems += rows.length;
    if (skip > rows.length) {
      throw new CliError('PAGINATION_RESUME', 'Paginate skip exceeds the number of rows in the first response.',
        'The page may have changed since the checkpoint; restart from a stable cursor.');
    }
    skippedItems += skip;
    for (let index = skip; index < rows.length; index++) {
      const item = rows[index];
      let identity: string | undefined;
      if (dedupeExpr) {
        const key = render(dedupeExpr, { ...context, item, index });
        if (key === null || (!isValue(key) && typeof key !== 'boolean')) {
          throw new CliError('PAGINATION_RESPONSE', `Paginate dedupeBy did not resolve to a scalar key on page ${pages}.`,
            'Every row needs a string, safe integer, or boolean identity; missing keys are not deduplicated.');
        }
        identity = valueKey(key);
        if (seenItems.has(identity)) { duplicateItems++; continue; }
      }
      // Consume trailing duplicates even at the cap, but leave the next new
      // row for the checkpoint. This can prove a capped final page complete.
      if (items.length === maxItems) {
        return finish('max_items', { value: currentValue, skip: index });
      }
      if (identity !== undefined) seenItems.add(identity);
      items.push(item);
    }
    if (next === null) return finish('exhausted', null);
    if (visited.has(valueKey(next))) {
      throw new CliError('PAGINATION_CYCLE', `Pagination repeated a cursor after ${pages} page(s).`,
        'Check the next expression and API response. No partial result was returned.');
    }
    if (items.length === maxItems) return finish('max_items', { value: next, skip: 0 });
    if (pages === maxPages) return finish('max_pages', { value: next, skip: 0 });
    value = next;
    skip = 0;
  }
  // maxPages is validated as positive; every final iteration returns above.
  throw new CliError('PAGINATION_LIMIT', 'Pagination ended without a completion record.');
}
