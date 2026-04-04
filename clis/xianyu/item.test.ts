import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, EmptyResultError, SelectorError } from '../../errors.js';
import { getRegistry } from '../../registry.js';
import type { IPage } from '../../types.js';
import { __test__ } from './item.js';
import './item.js';

function createPageMock(evaluateResult: unknown): IPage {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(evaluateResult),
    snapshot: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    typeText: vi.fn().mockResolvedValue(undefined),
    pressKey: vi.fn().mockResolvedValue(undefined),
    scrollTo: vi.fn().mockResolvedValue(undefined),
    getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
    wait: vi.fn().mockResolvedValue(undefined),
    tabs: vi.fn().mockResolvedValue([]),
    selectTab: vi.fn().mockResolvedValue(undefined),
    networkRequests: vi.fn().mockResolvedValue([]),
    consoleMessages: vi.fn().mockResolvedValue([]),
    scroll: vi.fn().mockResolvedValue(undefined),
    autoScroll: vi.fn().mockResolvedValue(undefined),
    installInterceptor: vi.fn().mockResolvedValue(undefined),
    getInterceptedRequests: vi.fn().mockResolvedValue([]),
    getCookies: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue(''),
    waitForCapture: vi.fn().mockResolvedValue(undefined),
  } as IPage;
}

describe('xianyu item helpers', () => {
  it('normalizes numeric item ids', () => {
    expect(__test__.normalizeNumericId('1040754408976', 'item_id', '1040754408976')).toBe('1040754408976');
    expect(__test__.normalizeNumericId(1040754408976, 'item_id', '1040754408976')).toBe('1040754408976');
  });

  it('builds item urls', () => {
    expect(__test__.buildItemUrl('1040754408976')).toBe(
      'https://www.goofish.com/item?id=1040754408976',
    );
  });

  it('rejects invalid item ids', () => {
    expect(() => __test__.normalizeNumericId('abc', 'item_id', '1040754408976')).toThrow();
  });
});

describe('xianyu item command', () => {
  const command = getRegistry().get('xianyu/item');

  it('throws AuthRequiredError on login wall before mtop is available', async () => {
    const page = createPageMock({ error: 'auth-required' });
    await expect(command!.func!(page, { item_id: '1040754408976' })).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('throws EmptyResultError on verification or risk-control pages', async () => {
    const page = createPageMock({ error: 'blocked' });
    await expect(command!.func!(page, { item_id: '1040754408976' })).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('keeps SelectorError for true mtop initialization failures', async () => {
    const page = createPageMock({ error: 'mtop-not-ready' });
    await expect(command!.func!(page, { item_id: '1040754408976' })).rejects.toBeInstanceOf(SelectorError);
  });
});
