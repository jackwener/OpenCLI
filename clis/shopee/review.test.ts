import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import './review.js';

const {
  EXPORT_REVIEW_BUTTON_SELECTOR,
  DETAIL_FILTER_INPUT_SELECTOR,
  SECONDARY_FILTER_INPUT_SELECTOR,
  CONFIRM_EXPORT_BUTTON_SELECTOR,
  normalizeShopeeReviewUrl,
  buildEnsureCheckboxStateScript,
  buildWaitForExportReviewReadyScript,
} =
  await import('./review.js').then((m) => (m as typeof import('./review.js')).__test__);

describe('shopee review adapter', () => {
  const command = getRegistry().get('shopee/review');

  it('registers the command with correct shape', () => {
    expect(command).toBeDefined();
    expect(command!.site).toBe('shopee');
    expect(command!.name).toBe('review');
    expect(command!.domain).toBe('shopee.sg');
    expect(command!.strategy).toBe('cookie');
    expect(command!.navigateBefore).toBe(false);
    expect(command!.columns).toEqual(['status', 'message', 'product_url']);
    expect(typeof command!.func).toBe('function');
  });

  it('has url as a required positional arg', () => {
    const urlArg = command!.args.find((arg) => arg.name === 'url');
    expect(urlArg).toBeDefined();
    expect(urlArg!.required).toBe(true);
    expect(urlArg!.positional).toBe(true);
  });

  it('normalizes a valid product url and rejects invalid values', () => {
    expect(normalizeShopeeReviewUrl('https://shopee.sg/item')).toBe('https://shopee.sg/item');
    expect(() => normalizeShopeeReviewUrl('')).toThrow('A Shopee product URL is required.');
    expect(() => normalizeShopeeReviewUrl('not-a-url')).toThrow('Shopee review requires a valid absolute product URL.');
  });

  it('builds DOM scripts around the recorded export workflow', () => {
    expect(buildEnsureCheckboxStateScript(DETAIL_FILTER_INPUT_SELECTOR, true)).toContain(DETAIL_FILTER_INPUT_SELECTOR);
    expect(buildEnsureCheckboxStateScript(SECONDARY_FILTER_INPUT_SELECTOR, false)).toContain('checkbox_not_found');
    expect(buildWaitForExportReviewReadyScript(30000, 1000)).toContain('.putButton .common-btn.en_common-btn');
    expect(buildWaitForExportReviewReadyScript(30000, 1000)).toContain('Export Review');
  });

  it('navigates and executes the recorded review export sequence', async () => {
    const goto = vi.fn<NonNullable<IPage['goto']>>().mockResolvedValue(undefined);
    const wait = vi.fn<NonNullable<IPage['wait']>>().mockResolvedValue(undefined);
    const click = vi.fn<NonNullable<IPage['click']>>().mockResolvedValue(undefined);
    const evaluate = vi.fn<NonNullable<IPage['evaluate']>>()
      .mockResolvedValueOnce({ ok: true, changed: false, checked: true })
      .mockResolvedValueOnce({ ok: true, changed: false, checked: false })
      .mockResolvedValueOnce({ ok: true, text: 'Export Review' });

    const page = { goto, wait, click, evaluate } as unknown as IPage;

    const result = await command!.func!(page, {
      url: 'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400',
    });

    expect(goto).toHaveBeenCalledWith(
      'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400',
      { waitUntil: 'load' },
    );
    expect(wait).toHaveBeenCalledWith({ selector: EXPORT_REVIEW_BUTTON_SELECTOR, timeout: 15 });
    expect(click).toHaveBeenCalledWith(EXPORT_REVIEW_BUTTON_SELECTOR);
    expect(click).toHaveBeenCalledWith(CONFIRM_EXPORT_BUTTON_SELECTOR);
    expect(evaluate).toHaveBeenNthCalledWith(1, expect.stringContaining(DETAIL_FILTER_INPUT_SELECTOR));
    expect(evaluate).toHaveBeenNthCalledWith(2, expect.stringContaining(SECONDARY_FILTER_INPUT_SELECTOR));
    expect(evaluate).toHaveBeenNthCalledWith(3, expect.stringContaining('.putButton .common-btn.en_common-btn'));
    expect(result).toEqual([{
      status: 'success',
      message: 'Triggered Shopee review export with the recorded good-detail filter.',
      product_url: 'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400',
    }]);
  });
});
