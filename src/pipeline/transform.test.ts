/**
 * Tests for pipeline transform steps: select, map, filter, sort, limit.
 */

import { describe, it, expect } from 'vitest';
import { stepSelect, stepMap, stepFilter, stepSort, stepLimit } from './steps/transform.js';

const SAMPLE_DATA = [
  { title: 'Alpha', score: 10, author: 'Alice' },
  { title: 'Beta', score: 30, author: 'Bob' },
  { title: 'Gamma', score: 20, author: 'Charlie' },
];

describe('stepSelect', () => {
  it('selects nested path', async () => {
    const data = { result: { items: [1, 2, 3] } };
    const result = await stepSelect(null, 'result.items', data, {});
    expect(result).toEqual([1, 2, 3]);
  });

  it('selects array by index', async () => {
    const data = { list: ['a', 'b', 'c'] };
    const result = await stepSelect(null, 'list.1', data, {});
    expect(result).toBe('b');
  });

  it('returns null for missing path', async () => {
    const result = await stepSelect(null, 'missing.path', { foo: 1 }, {});
    expect(result).toBeNull();
  });

  it('returns data as-is for non-object', async () => {
    const result = await stepSelect(null, 'foo', 'string-data', {});
    expect(result).toBe('string-data');
  });
});

describe('stepMap', () => {
  it('maps array items', async () => {
    const result = await stepMap(null, {
      name: '${{ item.title }}',
      rank: '${{ index + 1 }}',
    }, SAMPLE_DATA, {});
    expect(result).toEqual([
      { name: 'Alpha', rank: 1 },
      { name: 'Beta', rank: 2 },
      { name: 'Gamma', rank: 3 },
    ]);
  });

  it('handles single object', async () => {
    const result = await stepMap(null, {
      name: '${{ item.title }}',
    }, { title: 'Solo' }, {});
    expect(result).toEqual([{ name: 'Solo' }]);
  });

  it('returns null/undefined as-is', async () => {
    expect(await stepMap(null, { x: '${{ item.x }}' }, null, {})).toBeNull();
  });

  it('supports inline select before mapping', async () => {
    const result = await stepMap(null, {
      select: 'posts',
      title: '${{ item.title }}',
      rank: '${{ index + 1 }}',
    }, { posts: [{ title: 'One' }, { title: 'Two' }] }, {});

    expect(result).toEqual([
      { title: 'One', rank: 1 },
      { title: 'Two', rank: 2 },
    ]);
  });
});

describe('stepFilter', () => {
  it('filters by expression', async () => {
    const result = await stepFilter(null, 'item.score', SAMPLE_DATA, {});
    expect(result).toHaveLength(3); // all truthy
  });

  it('returns non-array as-is', async () => {
    const result = await stepFilter(null, 'item.x', 'not-array', {});
    expect(result).toBe('not-array');
  });
});

describe('stepSort', () => {
  it('sorts ascending by key', async () => {
    const result = await stepSort(null, 'score', SAMPLE_DATA, {});
    expect(result.map((r: any) => r.title)).toEqual(['Alpha', 'Gamma', 'Beta']);
  });

  it('sorts descending', async () => {
    const result = await stepSort(null, { by: 'score', order: 'desc' }, SAMPLE_DATA, {});
    expect(result.map((r: any) => r.title)).toEqual(['Beta', 'Gamma', 'Alpha']);
  });

  it('does not mutate original', async () => {
    const original = [...SAMPLE_DATA];
    await stepSort(null, 'score', SAMPLE_DATA, {});
    expect(SAMPLE_DATA).toEqual(original);
  });
});

describe('stepLimit', () => {
  it('limits array to N items', async () => {
    const result = await stepLimit(null, '2', SAMPLE_DATA, {});
    expect(result).toHaveLength(2);
  });

  it('limits using template expression', async () => {
    const result = await stepLimit(null, '${{ args.limit }}', SAMPLE_DATA, { limit: 1 });
    expect(result).toHaveLength(1);
  });

  it('returns non-array as-is', async () => {
    expect(await stepLimit(null, '5', 'string', {})).toBe('string');
  });
});
