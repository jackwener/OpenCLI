/**
 * Tests for pipeline/executor.ts: pipeline execution with mock page.
 */

import { describe, it, expect, vi } from 'vitest';
import { executePipeline } from './index.js';
import type { IPage } from '../types.js';

/** Create a minimal mock page for testing */
function createMockPage(overrides: Partial<IPage> = {}): IPage {
  return {
    goto: vi.fn(),
    evaluate: vi.fn().mockResolvedValue(null),
    getCookies: vi.fn().mockResolvedValue([]),
    snapshot: vi.fn().mockResolvedValue(''),
    click: vi.fn(),
    typeText: vi.fn(),
    pressKey: vi.fn(),
    scrollTo: vi.fn().mockResolvedValue(undefined),
    getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
    wait: vi.fn(),
    tabs: vi.fn().mockResolvedValue([]),
    closeTab: vi.fn(),
    newTab: vi.fn(),
    selectTab: vi.fn(),
    networkRequests: vi.fn().mockResolvedValue([]),
    consoleMessages: vi.fn().mockResolvedValue(''),
    scroll: vi.fn(),
    autoScroll: vi.fn(),
    installInterceptor: vi.fn(),
    getInterceptedRequests: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue(''),
    ...overrides,
  };
}

describe('executePipeline', () => {
  it('returns null for empty pipeline', async () => {
    const result = await executePipeline(null, []);
    expect(result).toBeNull();
  });

  it('skips null/invalid steps', async () => {
    const result = await executePipeline(null, [null, undefined, 42] as any);
    expect(result).toBeNull();
  });

  it('executes navigate step', async () => {
    const page = createMockPage();
    await executePipeline(page, [
      { navigate: 'https://example.com' },
    ]);
    expect(page.goto).toHaveBeenCalledWith('https://example.com');
  });

  it('executes evaluate + select pipeline', async () => {
    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue({ data: { list: [{ name: 'a' }, { name: 'b' }] } }),
    });
    const result = await executePipeline(page, [
      { evaluate: '() => ({ data: { list: [{name: "a"}, {name: "b"}] } })' },
      { select: 'data.list' },
    ]);
    expect(result).toEqual([{ name: 'a' }, { name: 'b' }]);
  });

  it('executes map step to transform items', async () => {
    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([
        { title: 'Hello', count: 10 },
        { title: 'World', count: 20 },
      ]),
    });
    const result = await executePipeline(page, [
      { evaluate: 'test' },
      { map: { name: '${{ item.title }}', score: '${{ item.count }}' } },
    ]);
    expect(result).toEqual([
      { name: 'Hello', score: 10 },
      { name: 'World', score: 20 },
    ]);
  });

  it('executes limit step', async () => {
    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([1, 2, 3, 4, 5]),
    });
    const result = await executePipeline(page, [
      { evaluate: 'test' },
      { limit: '3' },
    ]);
    expect(result).toEqual([1, 2, 3]);
  });

  it('executes sort step', async () => {
    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([{ n: 3 }, { n: 1 }, { n: 2 }]),
    });
    const result = await executePipeline(page, [
      { evaluate: 'test' },
      { sort: { by: 'n', order: 'asc' } },
    ]);
    expect(result).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it('executes sort step with desc order', async () => {
    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([{ n: 1 }, { n: 3 }, { n: 2 }]),
    });
    const result = await executePipeline(page, [
      { evaluate: 'test' },
      { sort: { by: 'n', order: 'desc' } },
    ]);
    expect(result).toEqual([{ n: 3 }, { n: 2 }, { n: 1 }]);
  });

  it('executes wait step with number', async () => {
    const page = createMockPage();
    await executePipeline(page, [
      { wait: 2 },
    ]);
    expect(page.wait).toHaveBeenCalledWith(2);
  });

  it('handles unknown steps gracefully in debug mode', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await executePipeline(null, [
      { unknownStep: 'test' },
    ], { debug: true });
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Unknown step'));
    stderr.mockRestore();
  });

  it('passes args through template rendering', async () => {
    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([1, 2, 3, 4, 5]),
    });
    const result = await executePipeline(page, [
      { evaluate: 'test' },
      { limit: '${{ args.count }}' },
    ], { args: { count: 2 } });
    expect(result).toEqual([1, 2]);
  });

  it('click step calls page.click', async () => {
    const page = createMockPage();
    await executePipeline(page, [
      { click: '@5' },
    ]);
    expect(page.click).toHaveBeenCalledWith('5');
  });

  it('navigate preserves existing data through pipeline', async () => {
    const page = createMockPage({
      evaluate: vi.fn().mockResolvedValue([{ a: 1 }]),
    });
    const result = await executePipeline(page, [
      { evaluate: 'test' },
      { navigate: 'https://example.com' },
    ]);
    // navigate should preserve existing data
    expect(result).toEqual([{ a: 1 }]);
    expect(page.goto).toHaveBeenCalledWith('https://example.com');
  });
});
