import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, CliError } from '../../errors.js';
import type { IPage } from '../../types.js';
import { stepPaginate } from './paginate.js';

const base = {
  request: { url: 'https://example.test/items', params: { cursor: '${{ pagination.value }}' } },
  items: '${{ data.items }}', next: '${{ data.next }}', initial: 'start',
};

function mockResponses(...responses: unknown[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce({ ok: true, json: async () => response });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('paginate', () => {
  it('fetches cursors sequentially and returns completeness and counters', async () => {
    const fetchMock = mockResponses({ items: [1, 2], next: 'two/+' }, { items: [3], next: null });
    const result = await stepPaginate(null, base, null, {});
    expect(result).toEqual({
      items: [1, 2, 3],
      pagination: { pages: 2, fetchedItems: 3, returnedItems: 3, duplicateItems: 0, skippedItems: 0, complete: true, stopReason: 'exhausted', resume: null },
    });
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get('cursor'))).toEqual(['start', 'two/+']);
  });

  it('supports page numbers with arithmetic and conditional next expressions', async () => {
    const fetchMock = mockResponses({ items: ['one'], totalPages: 2 }, { items: ['two'], totalPages: 2 });
    const result = await stepPaginate(null, {
      ...base, initial: 1,
      request: { url: 'https://example.test/items', params: { page: '${{ pagination.value }}', n: '${{ pagination.page }}' } },
      next: '${{ pagination.value < data.totalPages ? pagination.value + 1 : null }}',
    }, null, {});
    expect(result.items).toEqual(['one', 'two']);
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).search)).toEqual(['?page=1&n=1', '?page=2&n=2']);
  });

  it('supports offset pagination, zero initial values, and an empty terminal page', async () => {
    const fetchMock = mockResponses([1, 2], [3, 4], []);
    const result = await stepPaginate(null, {
      request: { url: 'https://example.test/items', params: { offset: '${{ pagination.value }}' } },
      initial: 0, items: '${{ data }}', next: '${{ data.length > 0 ? pagination.value + args.pageSize : null }}',
    }, null, { pageSize: 2 });
    expect(result.items).toEqual([1, 2, 3, 4]);
    expect(result.pagination.pages).toBe(3);
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get('offset'))).toEqual(['0', '2', '4']);
  });

  it('continues through empty or duplicate-only pages when the cursor advances', async () => {
    mockResponses(
      { items: [{ id: 1 }], next: 'a' }, { items: [], next: 'b' },
      { items: [{ id: 1 }], next: 'c' }, { items: [{ id: 2 }], next: false },
    );
    const result = await stepPaginate(null, { ...base, dedupeBy: '${{ item.id }}' }, null, {});
    expect(result.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.pagination).toMatchObject({ pages: 4, fetchedItems: 3, duplicateItems: 1, complete: true });
  });

  it('deduplicates within/across pages without collapsing scalar types or prototype-like strings', async () => {
    const ids = [1, '1', false, true, '__proto__', 'constructor', '', 1, false];
    mockResponses({ items: ids.map(id => ({ id })), next: null });
    const result = await stepPaginate(null, { ...base, dedupeBy: '${{ item.id }}' }, null, {});
    expect(result.items).toEqual(ids.slice(0, 7).map(id => ({ id })));
    expect(result.pagination.duplicateItems).toBe(2);
  });

  it('retains duplicates by default', async () => {
    mockResponses({ items: [1, 1], next: null });
    expect((await stepPaginate(null, base, null, {})).items).toEqual([1, 1]);
  });

  it('preserves input data and args for requests and exposes root input in selectors', async () => {
    const input = Object.freeze({ token: 'token', suffix: 'done' });
    const args = Object.freeze({ start: 5, limit: 3 });
    const fetchMock = mockResponses({ items: ['a'], next: 6 }, { items: ['b'], next: null });
    const result = await stepPaginate(null, {
      ...base, initial: '${{ args.start }}', maxItems: '${{ args.limit }}',
      request: { url: 'https://example.test/items', headers: { 'X-Token': '${{ data.token }}' }, params: { page: '${{ pagination.value }}' } },
      items: '${{ data.items.map(value => value + root.suffix) }}',
    }, input, args);
    expect(result.items).toEqual(['adone', 'bdone']);
    expect(fetchMock.mock.calls[1][1].headers).toEqual({ 'X-Token': 'token' });
    expect(input).toEqual({ token: 'token', suffix: 'done' });
    expect(args).toEqual({ start: 5, limit: 3 });
  });

  it('supports JSON POST bodies in browser context without batching or evaluating cursors twice', async () => {
    const cursor = '${{ args.secret }}';
    const page = { fetchJson: vi.fn().mockResolvedValueOnce({ items: [1], next: cursor }).mockResolvedValueOnce({ items: [2], next: null }), evaluate: vi.fn() } as unknown as IPage;
    const result = await stepPaginate(page, {
      ...base, initial: null,
      request: { url: '/graphql', method: 'post', body: { query: 'query List($after: String) { items(after: $after) { id } }', variables: { after: '${{ pagination.value }}', limit: '${{ args.limit }}' } } },
    }, [1, 2], { secret: 'DO_NOT_INTERPRET', limit: 2 });
    expect(result.items).toEqual([1, 2]);
    expect(page.fetchJson).toHaveBeenNthCalledWith(2, '/graphql', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: { query: 'query List($after: String) { items(after: $after) { id } }', variables: { after: cursor, limit: 2 } },
    });
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('serializes Node POST bodies and preserves explicit content type headers', async () => {
    const fetchMock = mockResponses({ items: [1], next: null });
    await stepPaginate(null, {
      ...base, request: { url: 'https://example.test/graphql', method: 'POST', headers: { 'content-type': 'application/custom+json' }, body: { cursor: '${{ pagination.value }}' } },
    }, null, {});
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/graphql', {
      method: 'POST', headers: { 'content-type': 'application/custom+json' }, body: '{"cursor":"start"}',
    });
  });

  for (const terminal of [null, false, '']) {
    it(`stops on explicit terminal ${JSON.stringify(terminal)}`, async () => {
      const fetchMock = mockResponses({ items: [1], next: terminal });
      expect((await stepPaginate(null, base, null, {})).pagination.complete).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  }

  it('treats zero as a real next cursor and missing final cursors only when explicitly normalized', async () => {
    const fetchMock = mockResponses({ items: [1], next: 0 }, { items: [2] });
    const result = await stepPaginate(null, { ...base, next: '${{ data.next ?? null }}' }, null, {});
    expect(result.pagination.complete).toBe(true);
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('cursor')).toBe('0');
  });

  it('returns a resumable page-bound checkpoint at maxPages', async () => {
    const fetchMock = mockResponses({ items: [1], next: 'two' }, { items: [2], next: 'three' });
    const result = await stepPaginate(null, { ...base, maxPages: '2' }, null, {});
    expect(result.items).toEqual([1, 2]);
    expect(result.pagination).toMatchObject({ complete: false, stopReason: 'max_pages', resume: { value: 'three', skip: 0 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not claim truncation when the final page exactly reaches a bound', async () => {
    mockResponses({ items: [1, 2], next: null });
    const result = await stepPaginate(null, { ...base, maxPages: 1, maxItems: 2, requireComplete: true }, null, {});
    expect(result.pagination).toMatchObject({ complete: true, stopReason: 'exhausted', resume: null });
  });

  it('resumes within a truncated page without dropping its unreturned rows', async () => {
    const fetchMock = mockResponses({ items: [1, 2, 3], next: 'two' });
    const first = await stepPaginate(null, { ...base, maxItems: 2 }, null, {});
    expect(first.pagination).toMatchObject({ fetchedItems: 3, returnedItems: 2, complete: false, stopReason: 'max_items', resume: { value: 'start', skip: 2 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    mockResponses({ items: [1, 2, 3], next: 'two' }, { items: [4], next: null });
    const second = await stepPaginate(null, { ...base, initial: first.pagination.resume!.value, skip: first.pagination.resume!.skip }, null, {});
    expect([...first.items, ...second.items]).toEqual([1, 2, 3, 4]);
    expect(second.pagination).toMatchObject({ skippedItems: 2, returnedItems: 2, complete: true });
  });

  it('records raw row offsets rather than deduplicated offsets when capped', async () => {
    mockResponses({ items: [1, 1, 2, 3], next: null });
    const result = await stepPaginate(null, { ...base, dedupeBy: '${{ item }}', maxItems: 2 }, null, {});
    expect(result.items).toEqual([1, 2]);
    expect(result.pagination).toMatchObject({ duplicateItems: 1, resume: { value: 'start', skip: 3 } });
  });

  it('resumes at the next cursor when a cap lands at a page boundary', async () => {
    mockResponses({ items: [1, 2], next: 'two' });
    expect((await stepPaginate(null, { ...base, maxItems: 2 }, null, {})).pagination.resume).toEqual({ value: 'two', skip: 0 });
  });

  it('proves completion when only duplicates remain after reaching the unique item cap', async () => {
    mockResponses({ items: [1, 2, 1, 2], next: null });
    const result = await stepPaginate(null, { ...base, dedupeBy: '${{ item }}', maxItems: 2, requireComplete: true }, null, {});
    expect(result.items).toEqual([1, 2]);
    expect(result.pagination).toMatchObject({ complete: true, duplicateItems: 2, resume: null });
  });

  it('includes trailing duplicate rows in the resume offset before the next new row', async () => {
    mockResponses({ items: [1, 2, 1, 2, 3], next: null });
    const result = await stepPaginate(null, { ...base, dedupeBy: '${{ item }}', maxItems: 2 }, null, {});
    expect(result.pagination).toMatchObject({ complete: false, duplicateItems: 2, resume: { value: 'start', skip: 4 } });
  });

  it('applies skip only to the first page, including a checkpoint at its end', async () => {
    mockResponses({ items: [1, 2], next: 'two' }, { items: [3, 4], next: null });
    const result = await stepPaginate(null, { ...base, skip: 2 }, null, {});
    expect(result.items).toEqual([3, 4]);
    expect(result.pagination.skippedItems).toBe(2);
  });

  it('fails on a stale checkpoint instead of silently skipping a shorter page', async () => {
    mockResponses({ items: [1], next: null });
    await expect(stepPaginate(null, { ...base, skip: 2 }, null, {})).rejects.toMatchObject({ code: 'PAGINATION_RESUME' });
  });

  it.each([{ maxPages: 1 }, { maxItems: 1 }])('enforces requireComplete with %j', async bound => {
    mockResponses({ items: [1, 2], next: 'two' });
    await expect(stepPaginate(null, { ...base, ...bound, requireComplete: true }, null, {})).rejects.toMatchObject({ code: 'PAGINATION_LIMIT' });
  });

  it('detects a multi-page cursor cycle without making a repeated request or exposing cursors', async () => {
    const fetchMock = mockResponses({ items: [1], next: 'SECRET_CURSOR' }, { items: [2], next: 'start' });
    const error = await stepPaginate(null, base, null, {}).catch(error => error);
    expect(error).toBeInstanceOf(CliError);
    expect(error.code).toBe('PAGINATION_CYCLE');
    expect(error.message).not.toContain('SECRET_CURSOR');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps numeric and string cursor identities distinct', async () => {
    mockResponses({ items: [1], next: '0' }, { items: [2], next: null });
    expect((await stepPaginate(null, { ...base, initial: 0 }, null, {})).pagination.pages).toBe(2);
  });

  it('waits only between actual page requests', async () => {
    vi.useFakeTimers();
    const fetchMock = mockResponses({ items: [1], next: 'two' }, { items: [2], next: null });
    const pending = stepPaginate(null, { ...base, delayMs: 250 }, null, {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).pagination.pages).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates a later HTTP failure instead of returning a successful partial result', async () => {
    const fetchMock = mockResponses({ items: [1], next: 'two' });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' });
    await expect(stepPaginate(null, base, null, {})).rejects.toMatchObject({ code: 'FETCH_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('propagates browser authentication errors without converting them to empty pages', async () => {
    const error = new CliError('AUTH_REQUIRED', 'Sign in first');
    const page = { fetchJson: vi.fn().mockRejectedValue(error) } as unknown as IPage;
    await expect(stepPaginate(page, base, null, {})).rejects.toBe(error);
  });

  it.each([undefined, null, {}, 'not an array'])('rejects a malformed items selection %j', async items => {
    mockResponses({ items, next: null });
    await expect(stepPaginate(null, base, null, {})).rejects.toMatchObject({ code: 'PAGINATION_RESPONSE' });
  });

  it.each([undefined, true, {}, [], NaN, Infinity, 0.5])('rejects a malformed next value %j', async next => {
    mockResponses({ items: [], next });
    await expect(stepPaginate(null, base, null, {})).rejects.toMatchObject({ code: 'PAGINATION_RESPONSE' });
  });

  it.each([undefined, null, {}, [], 0.5])('rejects a missing/invalid deduplication key %j', async id => {
    mockResponses({ items: [{ id }], next: null });
    await expect(stepPaginate(null, { ...base, dedupeBy: '${{ item.id }}' }, null, {})).rejects.toMatchObject({ code: 'PAGINATION_RESPONSE' });
  });

  const invalidOptions = [
    null, [], 'bad', {}, { ...base, typo: 1 }, { ...base, request: { url: '' } },
    ...[{ url: '/api', method: 'DELETE' }, { url: '/api', method: 1 }, { url: '/api', body: {} },
      { url: '/api', forEach: true }, { url: '/api', concurrency: 5 }, { url: '/api', headers: [] }, { url: '/api', params: 'x' },
    ].map(request => ({ ...base, request })),
    ...[{ items: 'items' }, { next: 'next' }, { dedupeBy: 'id' }, { initial: false }, { initial: 0.1 },
      { initial: '${{ args.missing }}' }, { maxPages: 0 }, { maxPages: 1001 }, { maxItems: 0 }, { maxItems: 100001 },
      { maxItems: '1e2' }, { maxItems: '10oops' }, { maxItems: true }, { maxItems: null }, { delayMs: -1 },
      { delayMs: 60001 }, { skip: -1 }, { skip: 1.5 }, { skip: Number.MAX_SAFE_INTEGER + 1 }, { requireComplete: 'true' },
    ].map(options => ({ ...base, ...options })),
  ];
  it.each(invalidOptions)('validates configuration before any request: %j', async options => {
    const fetchMock = mockResponses();
    await expect(stepPaginate(null, options, null, {})).rejects.toBeInstanceOf(ArgumentError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
