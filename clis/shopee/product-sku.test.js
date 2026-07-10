import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './product-sku.js';

const {
  PRODUCT_STOCK_COLUMNS,
  SHOPEE_PRODUCT_SKU_TIMEOUT_SECONDS,
  VARIANT_SELECTION_TIMEOUT_SECONDS,
  VARIATION_CAPTURE_TIMEOUT_SECONDS,
  MAX_COLLECTION_ATTEMPTS,
  VARIATION_API_PATTERN,
  VARIANT_CLICK_DELAY_RANGE_MS,
  buildSelectionKey,
  buildStockRow,
  extractPriceFromVariationPayload,
  extractStockFromVariationPayload,
  normalizeShopeeProductUrl,
  normalizePriceValue,
  normalizeStockValue,
  parseVariationCaptureEntry,
  sortOptionsForTraversal,
  upsertStockRow,
  bindShopeeProductTab,
  ensureShopeeProductPage,
} = await import('./product-sku.js').then((m) => m.__test__);

describe('shopee product-sku adapter', () => {
  const command = getRegistry().get('shopee/product-sku');

  it('registers the command with correct shape', () => {
    expect(command).toBeDefined();
    expect(command.site).toBe('shopee');
    expect(command.name).toBe('product-sku');
    expect(command.domain).toBe('shopee.sg');
    expect(command.strategy).toBe('cookie');
    expect(command.navigateBefore).toBe(false);
    expect(command.timeoutSeconds).toBe(SHOPEE_PRODUCT_SKU_TIMEOUT_SECONDS);
    expect(typeof command.func).toBe('function');
  });

  it('has url as a required positional arg', () => {
    const urlArg = command.args.find((arg) => arg.name === 'url');
    expect(urlArg).toBeDefined();
    expect(urlArg.required).toBe(true);
    expect(urlArg.positional).toBe(true);
  });

  it('exposes the stock output columns', () => {
    expect(PRODUCT_STOCK_COLUMNS).toEqual([
      'product_url',
      'title',
      'shopee_current_price',
      'group_count',
      'group_names',
      'option_labels',
      'sku',
      'stock',
      'stock_source',
    ]);
    expect(command.columns).toEqual(PRODUCT_STOCK_COLUMNS);
  });

  it('uses a short randomized delay before each variant click', () => {
    expect(VARIANT_CLICK_DELAY_RANGE_MS).toEqual([200, 600]);
  });

  it('uses shorter per-click waits and a longer command timeout for exhaustive SKU traversal', () => {
    expect(VARIANT_SELECTION_TIMEOUT_SECONDS).toBe(2);
    expect(VARIATION_CAPTURE_TIMEOUT_SECONDS).toBe(3);
    expect(MAX_COLLECTION_ATTEMPTS).toBe(2);
    expect(SHOPEE_PRODUCT_SKU_TIMEOUT_SECONDS).toBe(600);
  });
});

describe('shopee product-sku helpers', () => {
  it('normalizes a Shopee product url and rejects blank input', () => {
    expect(normalizeShopeeProductUrl('https://shopee.sg/product-i.1.2')).toBe('https://shopee.sg/product-i.1.2');
    expect(() => normalizeShopeeProductUrl('')).toThrow('A Shopee product URL is required.');
  });

  it('normalizes stock values from strings and numbers', () => {
    expect(normalizeStockValue('993')).toBe(993);
    expect(normalizeStockValue('1,234')).toBe(1234);
    expect(normalizeStockValue(88)).toBe(88);
    expect(normalizeStockValue('')).toBe('');
    expect(normalizePriceValue(445000)).toBe('$4.45');
    expect(normalizePriceValue('445000')).toBe('$4.45');
    expect(normalizePriceValue('4.45')).toBe('$4.45');
    expect(normalizePriceValue('$4.45')).toBe('$4.45');
  });

  it('extracts stock and price from the Shopee select_variation payload', () => {
    expect(extractStockFromVariationPayload({ data: { stock: 993 } })).toBe(993);
    expect(extractStockFromVariationPayload({ data: { stock: '1,024' } })).toBe(1024);
    expect(extractStockFromVariationPayload({})).toBe('');
    expect(extractPriceFromVariationPayload({ data: { product_price: { price: { single_value: 445000 } } } })).toBe('$4.45');
    expect(extractPriceFromVariationPayload({})).toBe('');
  });

  it('parses both interceptor payloads and native capture previews', () => {
    expect(parseVariationCaptureEntry({ data: { stock: 993, product_price: { price: { single_value: 445000 } } } })).toEqual({
      payload: { data: { stock: 993, product_price: { price: { single_value: 445000 } } } },
      stock: 993,
      shopee_current_price: '$4.45',
    });

    expect(parseVariationCaptureEntry({
      url: `https://shopee.sg${VARIATION_API_PATTERN}`,
      responsePreview: JSON.stringify({ data: { stock: 451, product_price: { price: { single_value: 1299000 } } } }),
    })).toEqual({
      payload: { data: { stock: 451, product_price: { price: { single_value: 1299000 } } } },
      stock: 451,
      shopee_current_price: '$12.99',
    });
  });

  it('orders selected options last so returning to the default option still triggers api capture', () => {
    expect(sortOptionsForTraversal([
      { buttonIndex: 2, selected: false },
      { buttonIndex: 0, selected: true },
      { buttonIndex: 1, selected: false },
    ])).toEqual([
      { buttonIndex: 1, selected: false },
      { buttonIndex: 2, selected: false },
      { buttonIndex: 0, selected: true },
    ]);
  });

  it('builds a stable selection key and prefers api rows over dom fallback rows', () => {
    const rowsByKey = new Map();
    const snapshot = {
      title: 'Fast Charging Cable',
      groups: [{}, {}],
      groupNames: ['Color', 'Size'],
      selectedLabels: ['Black', '1m'],
    };

    const domRow = buildStockRow('https://shopee.sg/product-i.1.2', snapshot, 12, '', 'dom');
    upsertStockRow(rowsByKey, domRow);

    const apiRow = buildStockRow('https://shopee.sg/product-i.1.2', snapshot, 13, '$4.45', 'api');
    upsertStockRow(rowsByKey, apiRow);

    expect(buildSelectionKey(['Black', '1m'])).toBe(JSON.stringify(['Black', '1m']));
    expect([...rowsByKey.values()]).toEqual([apiRow]);
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

  it('reuses the matched tab and reloads the product page', async () => {
    const page = {
      goto: vi.fn(async () => {}),
    };
    const bindFn = vi.fn(async () => ({ tabId: 2 }));

    await expect(ensureShopeeProductPage(page, 'https://shopee.sg/product-i.1.2', bindFn)).resolves.toBeUndefined();

    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith('https://shopee.sg/product-i.1.2', { waitUntil: 'load' });
  });
});
