import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import './product-shopdora-download.js';

const {
  EXPORT_DIALOG_SELECTOR,
  EXPORT_REVIEW_BUTTON_SELECTOR,
  DETAIL_FILTER_INPUT_SELECTOR,
  TIME_PERIOD_START_INPUT_SELECTOR,
  TIME_PERIOD_START_MONTH_OFFSET,
  TIME_PERIOD_START_DAY_OFFSET,
  CONFIRM_EXPORT_BUTTON_SELECTOR,
  normalizeShopeeReviewUrl,
  bindShopeeProductTab,
  ensureShopeeProductPage,
  buildEnsureCheckboxStateScript,
  buildResolveTargetSelectorScript,
  buildReadInputValueScript,
  buildDispatchEnterOnInputScript,
  computeShiftedDateFromInputValue,
  buildWaitForExportReviewReadyScript,
  setComputedTimePeriodStartValue,
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
    expect(command!.timeoutSeconds).toBe(600);
    expect(command!.columns).toEqual(['status', 'message', 'local_url', 'local_path', 'product_url', 'shopdora_login_message']);
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
    expect(buildEnsureCheckboxStateScript(DETAIL_FILTER_INPUT_SELECTOR, true)).toContain('download-review-images-input');
    expect(buildResolveTargetSelectorScript('download-review-images-input')).toContain('Download review images');
    expect(buildResolveTargetSelectorScript('time-period-start-input')).toContain('Time Period');
    expect(buildResolveTargetSelectorScript('confirm-export-button')).toContain('Download');
    expect(TIME_PERIOD_START_INPUT_SELECTOR).toContain('time-period-start-input');
    expect(TIME_PERIOD_START_MONTH_OFFSET).toBe(-3);
    expect(TIME_PERIOD_START_DAY_OFFSET).toBe(7);
    expect(buildReadInputValueScript(TIME_PERIOD_START_INPUT_SELECTOR)).toContain('time-period-start-input');
    expect(buildDispatchEnterOnInputScript(TIME_PERIOD_START_INPUT_SELECTOR)).toContain("new KeyboardEvent('keydown'");
    expect(buildDispatchEnterOnInputScript(TIME_PERIOD_START_INPUT_SELECTOR)).toContain("new KeyboardEvent('keypress'");
    expect(buildDispatchEnterOnInputScript(TIME_PERIOD_START_INPUT_SELECTOR)).toContain("new KeyboardEvent('keyup'");
    expect(buildWaitForExportReviewReadyScript(300000, 1000)).toContain('.putButton .common-btn.en_common-btn');
    expect(buildWaitForExportReviewReadyScript(300000, 1000)).toContain('.shopdoraLoginPage');
    expect(buildWaitForExportReviewReadyScript(300000, 1000)).toContain('Export Review');
  });

  it('computes the date from the input value using -3 months + 7 days', () => {
    expect(computeShiftedDateFromInputValue('2026-04-14')).toBe('2026-01-21');
    expect(computeShiftedDateFromInputValue('2026/05/31')).toBe('2026-03-07');
    expect(() => computeShiftedDateFromInputValue('not-a-date')).toThrow(
      'Shopee product-shopdora-download could not parse the time-period start date',
    );
  });

  it('clicks, computes from the current input value, types the result, and presses Enter', async () => {
    const click = vi.fn<NonNullable<IPage['click']>>().mockResolvedValue(undefined);
    const typeText = vi.fn<NonNullable<IPage['typeText']>>().mockResolvedValue(undefined);
    const pressKey = vi.fn<NonNullable<IPage['pressKey']>>().mockResolvedValue(undefined);
    const nativeKeyPress = vi.fn<NonNullable<NonNullable<IPage['nativeKeyPress']>>>().mockResolvedValue(undefined);
    const wait = vi.fn<NonNullable<IPage['wait']>>().mockResolvedValue(undefined);
    const evaluate = vi.fn<NonNullable<IPage['evaluate']>>().mockImplementation(async (script) => {
      const source = String(script ?? '');
      if (source.includes('const target = "time-period-start-input";')) {
        return { ok: true, selector: TIME_PERIOD_START_INPUT_SELECTOR };
      }
      if (source.includes("new KeyboardEvent('keydown'")) {
        return { ok: true };
      }
      return { ok: true, value: '2026-04-14' };
    });
    const page = { click, typeText, pressKey, nativeKeyPress, wait, evaluate } as unknown as IPage;

    await expect(
      setComputedTimePeriodStartValue(page),
    ).resolves.toBe('2026-01-21');

    expect(click).toHaveBeenCalledWith(TIME_PERIOD_START_INPUT_SELECTOR);
    expect(evaluate).toHaveBeenNthCalledWith(1, expect.stringContaining('const target = "time-period-start-input";'));
    expect(evaluate).toHaveBeenCalledWith(expect.stringContaining('time-period-start-input'));
    expect(typeText).toHaveBeenCalledWith(TIME_PERIOD_START_INPUT_SELECTOR, '2026-01-21');
    expect(evaluate).toHaveBeenCalledWith(expect.stringContaining("new KeyboardEvent('keydown'"));
    expect(nativeKeyPress).toHaveBeenCalledWith('Enter');
    expect(pressKey).not.toHaveBeenCalled();
    expect(wait).toHaveBeenCalled();
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

    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://shopee.sg/product-i.1.2', { waitUntil: 'load' });
  });

  it('navigates, downloads the file, and returns the local file url', async () => {
    const downloadedFile = '/tmp/opencli-shopee-product-shopdora-download-test/reviews.csv';
    const goto = vi.fn<NonNullable<IPage['goto']>>().mockResolvedValue(undefined);
    const wait = vi.fn<NonNullable<IPage['wait']>>().mockResolvedValue(undefined);
    const click = vi.fn<NonNullable<IPage['click']>>().mockResolvedValue(undefined);
    const typeText = vi.fn<NonNullable<IPage['typeText']>>().mockResolvedValue(undefined);
    const pressKey = vi.fn<NonNullable<IPage['pressKey']>>().mockResolvedValue(undefined);
    const scroll = vi.fn<NonNullable<IPage['scroll']>>().mockResolvedValue(undefined);
    const evaluate = vi.fn<NonNullable<IPage['evaluate']>>().mockImplementation(async (script) => {
      const source = String(script ?? '');
      if (source.includes('.shopdoraLoginPage') && source.includes('.pageDetailLoginTitle') && !source.includes('.putButton .common-btn.en_common-btn')) {
        return { hasShopdoraLoginPage: false, hasPageDetailLoginTitle: false };
      }
      if (source.includes('const target = "export-review-button";')) {
        return { ok: true, selector: EXPORT_REVIEW_BUTTON_SELECTOR };
      }
      if (source.includes('const target = "time-period-start-input";')) {
        return { ok: true, selector: TIME_PERIOD_START_INPUT_SELECTOR };
      }
      if (source.includes('const target = "download-review-images-label";')) {
        return { ok: true, selector: '[data-opencli-shopee-product-shopdora-download-target="download-review-images-label"]' };
      }
      if (source.includes('const target = "download-review-images-input";')) {
        return { ok: true, selector: DETAIL_FILTER_INPUT_SELECTOR };
      }
      if (source.includes('const target = "confirm-export-button";')) {
        return { ok: true, selector: CONFIRM_EXPORT_BUTTON_SELECTOR };
      }
      if (source.includes("new KeyboardEvent('keydown'")) {
        return { ok: true };
      }
      if (source.includes('value: input.value') && source.includes('time-period-start-input')) {
        return { ok: true, value: '2026-04-14' };
      }
      if (source.includes('.putButton .common-btn.en_common-btn')) {
        return { ok: true, text: 'Export Review' };
      }
      return { ok: true };
    });
    const waitForDownload = vi.fn<NonNullable<NonNullable<IPage['waitForDownload']>>>()
      .mockResolvedValue({ filename: downloadedFile });

    const page = { goto, wait, click, typeText, pressKey, scroll, evaluate, waitForDownload } as unknown as IPage;

    const result = await command!.func!(page, {
      url: 'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400',
    });

    expect(goto).toHaveBeenCalledTimes(1);
    expect(goto).toHaveBeenNthCalledWith(
      1,
      'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400',
      { waitUntil: 'load' },
    );
    expect(wait).toHaveBeenCalledWith({ selector: '.putButton .common-btn.en_common-btn', timeout: 15 });
    expect(click).toHaveBeenCalledWith(EXPORT_REVIEW_BUTTON_SELECTOR);
    expect(click).toHaveBeenCalledWith(TIME_PERIOD_START_INPUT_SELECTOR);
    expect(click).toHaveBeenCalledWith(CONFIRM_EXPORT_BUTTON_SELECTOR);
    expect(typeText).toHaveBeenCalledWith(TIME_PERIOD_START_INPUT_SELECTOR, '2026-01-21');
    expect(pressKey).toHaveBeenCalledWith('Enter');
    expect(scroll).toHaveBeenCalled();
    expect(evaluate).toHaveBeenCalledWith(expect.stringContaining('export-review-button'));
    expect(wait).toHaveBeenCalledWith({ selector: EXPORT_DIALOG_SELECTOR, timeout: 10 });
    expect(evaluate).toHaveBeenCalledWith(expect.stringContaining('download-review-images-input'));
    expect(evaluate).toHaveBeenCalledWith(expect.stringContaining('confirm-export-button'));
    expect(evaluate).toHaveBeenCalledWith(expect.stringContaining('.putButton .common-btn.en_common-btn'));
    expect(waitForDownload).toHaveBeenCalledWith({
      startedAfterMs: expect.any(Number),
      timeoutMs: 600000,
    });
    expect(result).toEqual([{
      status: 'success',
      message: 'Downloaded Shopee product Shopdora export with the recorded good-detail filter.',
      local_url: pathToFileURL(downloadedFile).href,
      local_path: downloadedFile,
      product_url: 'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400',
      shopdora_login_message: '',
    }]);
  });

  it('skips the detail filter when it is unavailable and continues downloading', async () => {
    const downloadedFile = '/tmp/opencli-shopee-product-shopdora-download-test/reviews-no-detail.csv';
    const goto = vi.fn<NonNullable<IPage['goto']>>().mockResolvedValue(undefined);
    const wait = vi.fn<NonNullable<IPage['wait']>>().mockResolvedValue(undefined);
    const click = vi.fn<NonNullable<IPage['click']>>().mockResolvedValue(undefined);
    const typeText = vi.fn<NonNullable<IPage['typeText']>>().mockResolvedValue(undefined);
    const pressKey = vi.fn<NonNullable<IPage['pressKey']>>().mockResolvedValue(undefined);
    const scroll = vi.fn<NonNullable<IPage['scroll']>>().mockResolvedValue(undefined);
    const evaluate = vi.fn<NonNullable<IPage['evaluate']>>().mockImplementation(async (script) => {
      const source = String(script ?? '');
      if (source.includes('.shopdoraLoginPage') && source.includes('.pageDetailLoginTitle') && !source.includes('.putButton .common-btn.en_common-btn')) {
        return { hasShopdoraLoginPage: false, hasPageDetailLoginTitle: false };
      }
      if (source.includes('const target = "export-review-button";')) {
        return { ok: true, selector: EXPORT_REVIEW_BUTTON_SELECTOR };
      }
      if (source.includes('const target = "time-period-start-input";')) {
        return { ok: true, selector: TIME_PERIOD_START_INPUT_SELECTOR };
      }
      if (source.includes('const target = "download-review-images-label";') || source.includes('const target = "download-review-images-input";')) {
        return { ok: false, error: 'target_not_found' };
      }
      if (source.includes('const target = "confirm-export-button";')) {
        return { ok: true, selector: CONFIRM_EXPORT_BUTTON_SELECTOR };
      }
      if (source.includes("new KeyboardEvent('keydown'")) {
        return { ok: true };
      }
      if (source.includes('value: input.value') && source.includes('time-period-start-input')) {
        return { ok: true, value: '2026-04-14' };
      }
      if (source.includes('.putButton .common-btn.en_common-btn')) {
        return { ok: true, text: 'Export Review' };
      }
      return { ok: true };
    });
    const waitForDownload = vi.fn<NonNullable<NonNullable<IPage['waitForDownload']>>>()
      .mockResolvedValue({ filename: downloadedFile });

    const page = { goto, wait, click, typeText, pressKey, scroll, evaluate, waitForDownload } as unknown as IPage;

    const result = await command!.func!(page, {
      url: 'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400',
    });

    expect(click).toHaveBeenCalledWith(CONFIRM_EXPORT_BUTTON_SELECTOR);
    expect(waitForDownload).toHaveBeenCalledWith({
      startedAfterMs: expect.any(Number),
      timeoutMs: 600000,
    });
    expect(result).toEqual([{
      status: 'success',
      message: 'Downloaded Shopee product Shopdora export after skipping the unavailable detail filter.',
      local_url: pathToFileURL(downloadedFile).href,
      local_path: downloadedFile,
      product_url: 'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400',
      shopdora_login_message: '',
    }]);
  });

  it('appends the Shopdora login message when the soft login title is present on the page', async () => {
    const downloadedFile = '/tmp/opencli-shopee-product-shopdora-download-test/reviews-soft-login.csv';
    const goto = vi.fn<NonNullable<IPage['goto']>>().mockResolvedValue(undefined);
    const wait = vi.fn<NonNullable<IPage['wait']>>().mockResolvedValue(undefined);
    const click = vi.fn<NonNullable<IPage['click']>>().mockResolvedValue(undefined);
    const typeText = vi.fn<NonNullable<IPage['typeText']>>().mockResolvedValue(undefined);
    const pressKey = vi.fn<NonNullable<IPage['pressKey']>>().mockResolvedValue(undefined);
    const scroll = vi.fn<NonNullable<IPage['scroll']>>().mockResolvedValue(undefined);
    const evaluate = vi.fn<NonNullable<IPage['evaluate']>>().mockImplementation(async (script) => {
      const source = String(script ?? '');
      if (source.includes('.shopdoraLoginPage') && source.includes('.pageDetailLoginTitle') && !source.includes('.putButton .common-btn.en_common-btn')) {
        return { hasShopdoraLoginPage: false, hasPageDetailLoginTitle: true };
      }
      if (source.includes('const target = "export-review-button";')) {
        return { ok: true, selector: EXPORT_REVIEW_BUTTON_SELECTOR };
      }
      if (source.includes('const target = "time-period-start-input";')) {
        return { ok: true, selector: TIME_PERIOD_START_INPUT_SELECTOR };
      }
      if (source.includes('const target = "download-review-images-label";')) {
        return { ok: true, selector: '[data-opencli-shopee-product-shopdora-download-target="download-review-images-label"]' };
      }
      if (source.includes('const target = "download-review-images-input";')) {
        return { ok: true, selector: DETAIL_FILTER_INPUT_SELECTOR };
      }
      if (source.includes('const target = "confirm-export-button";')) {
        return { ok: true, selector: CONFIRM_EXPORT_BUTTON_SELECTOR };
      }
      if (source.includes("new KeyboardEvent('keydown'")) {
        return { ok: true };
      }
      if (source.includes('value: input.value') && source.includes('time-period-start-input')) {
        return { ok: true, value: '2026-04-14' };
      }
      if (source.includes('.putButton .common-btn.en_common-btn')) {
        return { ok: true, text: 'Export Review' };
      }
      return { ok: true };
    });
    const waitForDownload = vi.fn<NonNullable<NonNullable<IPage['waitForDownload']>>>()
      .mockResolvedValue({ filename: downloadedFile });
    const page = { goto, wait, click, typeText, pressKey, scroll, evaluate, waitForDownload } as unknown as IPage;

    const result = await command!.func!(page, {
      url: 'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400',
    });

    expect(result).toEqual([{
      status: 'success',
      message: 'Downloaded Shopee product Shopdora export with the recorded good-detail filter. Shopdora 未登录。',
      local_url: pathToFileURL(downloadedFile).href,
      local_path: downloadedFile,
      product_url: 'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400',
      shopdora_login_message: 'Shopdora 未登录',
    }]);
  });

  it('returns the login info immediately when export opens the Shopdora login page', async () => {
    const goto = vi.fn<NonNullable<IPage['goto']>>().mockResolvedValue(undefined);
    const wait = vi.fn<NonNullable<IPage['wait']>>().mockResolvedValue(undefined);
    const click = vi.fn<NonNullable<IPage['click']>>().mockResolvedValue(undefined);
    const typeText = vi.fn<NonNullable<IPage['typeText']>>().mockResolvedValue(undefined);
    const pressKey = vi.fn<NonNullable<IPage['pressKey']>>().mockResolvedValue(undefined);
    const scroll = vi.fn<NonNullable<IPage['scroll']>>().mockResolvedValue(undefined);
    let loginCheckCount = 0;
    const evaluate = vi.fn<NonNullable<IPage['evaluate']>>().mockImplementation(async (script) => {
      const source = String(script ?? '');
      if (source.includes('.shopdoraLoginPage') && source.includes('.pageDetailLoginTitle') && !source.includes('.putButton .common-btn.en_common-btn')) {
        loginCheckCount += 1;
        return loginCheckCount === 1
          ? { hasShopdoraLoginPage: false, hasPageDetailLoginTitle: false }
          : { hasShopdoraLoginPage: true, hasPageDetailLoginTitle: false };
      }
      if (source.includes('const target = "export-review-button";')) {
        return { ok: true, selector: EXPORT_REVIEW_BUTTON_SELECTOR };
      }
      return { ok: true };
    });
    const waitForDownload = vi.fn<NonNullable<NonNullable<IPage['waitForDownload']>>>()
      .mockResolvedValue({ filename: '/tmp/should-not-download.csv' });
    const page = { goto, wait, click, typeText, pressKey, scroll, evaluate, waitForDownload } as unknown as IPage;

    await expect(command!.func!(page, {
      url: 'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400',
    })).resolves.toEqual([{
      status: 'not_logged_in',
      message: 'Shopdora 未登录，请先登录 Shopdora 后重试。',
      local_url: '',
      local_path: '',
      product_url: 'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400',
      shopdora_login_message: 'Shopdora 未登录',
    }]);

    expect(wait).not.toHaveBeenCalledWith({ selector: EXPORT_DIALOG_SELECTOR, timeout: 10 });
    expect(typeText).not.toHaveBeenCalled();
    expect(waitForDownload).not.toHaveBeenCalled();
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

    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://shopee.sg/product-i.1.2', { waitUntil: 'load' });
  });
});
