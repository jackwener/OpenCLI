import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IPage } from '@jackwener/opencli/types';
import { __test__ } from './shared.js';

describe('shopee shared humanization helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a pointer simulation script for the target selector', () => {
    const script = __test__.buildHumanPointerScript('.target-button');
    expect(script).toContain('.target-button');
    expect(script).toContain('mousemove');
    expect(script).toContain('scrollIntoView');
  });

  it('builds a localStorage clearing script scoped to the target host', () => {
    const script = __test__.buildClearLocalStorageScript('shopee.sg');
    expect(script).toContain('shopee.sg');
    expect(script).toContain('localStorage.clear()');
    expect(script).toContain('host_mismatch');
  });

  it('waits for a randomized duration within the provided range', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const wait = vi.fn<NonNullable<IPage['wait']>>().mockResolvedValue(undefined);
    const page = { wait } as unknown as IPage;

    const seconds = await __test__.waitRandomDuration(page, [200, 600]);

    expect(seconds).toBe(0.8);
    expect(wait).toHaveBeenCalledWith(0.8);
  });

  it('simulates lightweight human behavior around a selector', async () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.4)
      .mockReturnValueOnce(0.2)
      .mockReturnValueOnce(0.3)
      .mockReturnValueOnce(0.5);

    const page = {
      wait: vi.fn<NonNullable<IPage['wait']>>().mockResolvedValue(undefined),
      scroll: vi.fn<NonNullable<IPage['scroll']>>().mockResolvedValue(undefined),
      evaluate: vi.fn<NonNullable<IPage['evaluate']>>().mockResolvedValue({ ok: true }),
    } as unknown as IPage;

    await __test__.simulateHumanBehavior(page, {
      selector: '.target-button',
      preWaitRangeMs: [200, 600],
      postWaitRangeMs: [100, 300],
      scrollRangePx: [100, 300],
    });

    expect(page.wait).toHaveBeenCalledTimes(2);
    expect(page.wait).toHaveBeenNthCalledWith(1, 0.8);
    expect(page.wait).toHaveBeenNthCalledWith(2, 0.4);
    expect(page.scroll).toHaveBeenCalledWith('down', 180);
    expect(page.scroll).toHaveBeenCalledWith('up', 58);
    expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('.target-button'));
  });

  it('navigates to the target origin before clearing localStorage for that host', async () => {
    const goto = vi.fn<NonNullable<IPage['goto']>>().mockResolvedValue(undefined);
    const evaluate = vi.fn<NonNullable<IPage['evaluate']>>().mockResolvedValue({ ok: true, host: 'shopee.sg' });
    const page = { goto, evaluate } as unknown as IPage;

    await __test__.clearLocalStorageForUrlHost(page, 'https://shopee.sg/product-i.1.2');

    expect(goto).toHaveBeenCalledWith('https://shopee.sg', { waitUntil: 'load' });
    expect(evaluate).toHaveBeenCalledWith(expect.stringContaining('localStorage.clear()'));
    expect(evaluate).toHaveBeenCalledWith(expect.stringContaining('shopee.sg'));
  });
});
