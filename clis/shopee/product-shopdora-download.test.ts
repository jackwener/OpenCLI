import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import './product-shopdora-download.js';

const {
  EXPORT_REVIEW_BUTTON_SELECTOR,
  DETAIL_FILTER_INPUT_SELECTOR,
  SECONDARY_FILTER_INPUT_SELECTOR,
  CONFIRM_EXPORT_BUTTON_SELECTOR,
  normalizeShopeeReviewUrl,
  bindShopeeProductTab,
  ensureShopeeProductPage,
  buildEnsureCheckboxStateScript,
  buildWaitForExportReviewReadyScript,
} =
  await import('./product-shopdora-download.js').then((m) => (m as typeof import('./product-shopdora-download.js')).__test__);

describe('shopee product-shopdora-download adapter', () => {
  const command = getRegistry().get('shopee/product-shopdora-download');

  it('registers the command with correct shape', () => {
    expect(command).toBeDefined();
    expect(command!.site).toBe('shopee');
    expect(command!.name).toBe('product-shopdora-download');
    expect(command!.domain).toBe('shopee.sg');
    expect(command!.strategy).toBe('cookie');
    expect(command!.navigateBefore).toBe(false);
    expect(command!.columns).toEqual(['status', 'message', 'local_url', 'local_path', 'product_url']);
    expect(typeof command!.func).toBe('function');
  });

  it('has url as a required positional arg', () => {
    const urlArg = command!.args.find((arg) => arg.name === 'url');
    expect(urlArg).toBeDefined();
    expect(urlArg!.required).toBe(true);
    expect(urlArg!.positional).toBe(true);
  });

  it('normalizes product urls', () => {
    expect(normalizeShopeeReviewUrl('https://shopee.sg/item')).toBe('https://shopee.sg/item');
    expect(() => normalizeShopeeReviewUrl('')).toThrow('A Shopee product URL is required.');
    expect(() => normalizeShopeeReviewUrl('not-a-url')).toThrow('Shopee product-shopdora-download requires a valid absolute product URL.');
  });

  it('builds DOM scripts around the recorded export workflow', () => {
    expect(buildEnsureCheckboxStateScript(DETAIL_FILTER_INPUT_SELECTOR, true)).toContain(DETAIL_FILTER_INPUT_SELECTOR);
    expect(buildEnsureCheckboxStateScript(SECONDARY_FILTER_INPUT_SELECTOR, false)).toContain('checkbox_not_found');
    expect(buildWaitForExportReviewReadyScript(30000, 1000)).toContain('.putButton .common-btn.en_common-btn');
    expect(buildWaitForExportReviewReadyScript(30000, 1000)).toContain('Export Review');
  });

  it('binds to the matching existing browser tab using the shopee workspace', async () => {
    const bindFn = vi.fn(async () => ({ tabId: 2 }));

    await expect(
      bindShopeeProductTab(
        'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400',
        bindFn,
      ),
    ).resolves.toBe(true);

    expect(bindFn).toHaveBeenCalledWith('site:shopee', {
      matchUrl: 'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400',
    });
  });

  it('reuses the matched tab, clears localStorage, and reloads the product page', async () => {
    const page = {
      goto: vi.fn(async () => {}),
      evaluate: vi.fn(async () => ({ ok: true, host: 'shopee.sg' })),
    } as unknown as IPage;
    const bindFn = vi.fn(async () => ({ tabId: 2 }));

    await expect(
      ensureShopeeProductPage(page, 'https://shopee.sg/product-i.1.2', bindFn),
    ).resolves.toBe(true);

    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://shopee.sg', { waitUntil: 'load' });
    expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('localStorage.clear()'));
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://shopee.sg/product-i.1.2', { waitUntil: 'load' });
  });

  it('navigates, downloads the file, and returns the local file url', async () => {
    const downloadedFile = '/tmp/opencli-shopee-product-shopdora-download-test/reviews.csv';
    const goto = vi.fn<NonNullable<IPage['goto']>>().mockResolvedValue(undefined);
    const wait = vi.fn<NonNullable<IPage['wait']>>().mockResolvedValue(undefined);
    const click = vi.fn<NonNullable<IPage['click']>>().mockResolvedValue(undefined);
    const scroll = vi.fn<NonNullable<IPage['scroll']>>().mockResolvedValue(undefined);
    const evaluate = vi.fn<NonNullable<IPage['evaluate']>>()
      .mockResolvedValueOnce({ ok: true, host: 'shopee.sg' })
      .mockResolvedValue({ ok: true, text: 'Export Review' });
    const waitForDownload = vi.fn<NonNullable<NonNullable<IPage['waitForDownload']>>>()
      .mockResolvedValue({ filename: downloadedFile });

    const page = { goto, wait, click, scroll, evaluate, waitForDownload } as unknown as IPage;

    const result = await command!.func!(page, {
      url: 'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400',
    });

    expect(goto).toHaveBeenNthCalledWith(1, 'https://shopee.sg', { waitUntil: 'load' });
    expect(goto).toHaveBeenNthCalledWith(
      2,
      'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400',
      { waitUntil: 'load' },
    );
    expect(evaluate).toHaveBeenNthCalledWith(1, expect.stringContaining('localStorage.clear()'));
    expect(wait).toHaveBeenCalledWith({ selector: EXPORT_REVIEW_BUTTON_SELECTOR, timeout: 15 });
    expect(click).toHaveBeenCalledWith(EXPORT_REVIEW_BUTTON_SELECTOR);
    expect(click).toHaveBeenCalledWith(CONFIRM_EXPORT_BUTTON_SELECTOR);
    expect(scroll).toHaveBeenCalled();
    expect(evaluate).toHaveBeenCalledWith(expect.stringContaining(EXPORT_REVIEW_BUTTON_SELECTOR));
    expect(evaluate).toHaveBeenCalledWith(expect.stringContaining(DETAIL_FILTER_INPUT_SELECTOR));
    expect(evaluate).toHaveBeenCalledWith(expect.stringContaining(SECONDARY_FILTER_INPUT_SELECTOR));
    expect(evaluate).toHaveBeenCalledWith(expect.stringContaining(CONFIRM_EXPORT_BUTTON_SELECTOR));
    expect(evaluate).toHaveBeenCalledWith(expect.stringContaining('.putButton .common-btn.en_common-btn'));
    expect(waitForDownload).toHaveBeenCalledWith({
      startedAfterMs: expect.any(Number),
      timeoutMs: 30000,
    });
    expect(result).toEqual([{
      status: 'success',
      message: 'Downloaded Shopee product Shopdora export with the recorded good-detail filter.',
      local_url: pathToFileURL(downloadedFile).href,
      local_path: downloadedFile,
      product_url: 'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400',
    }]);
  });

  it('falls back to clearing the target host and reopening the product page when no existing product tab is found', async () => {
    const page = {
      goto: vi.fn(async () => {}),
      evaluate: vi.fn(async () => ({ ok: true, host: 'shopee.sg' })),
    } as unknown as IPage;
    const bindFn = vi.fn(async () => {
      throw new Error('not found');
    });

    await expect(
      ensureShopeeProductPage(page, 'https://shopee.sg/product-i.1.2', bindFn),
    ).resolves.toBe(false);

    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://shopee.sg', { waitUntil: 'load' });
    expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('localStorage.clear()'));
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://shopee.sg/product-i.1.2', { waitUntil: 'load' });
  });
});
