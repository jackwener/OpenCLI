import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './product.js';

const {
  PRODUCT_COLUMNS,
  PRODUCT_FIELDS,
  mergeProductDetails,
  hasMeaningfulProductData,
  bindShopeeProductTab,
  ensureShopeeProductPage,
} =
  await import('./product.js').then((m) => (m as typeof import('./product.js')).__test__);

describe('shopee product adapter', () => {
  const command = getRegistry().get('shopee/product');

  it('registers the command with correct shape', () => {
    expect(command).toBeDefined();
    expect(command!.site).toBe('shopee');
    expect(command!.name).toBe('product');
    expect(command!.domain).toBe('shopee.sg');
    expect(command!.strategy).toBe('cookie');
    expect(command!.navigateBefore).toBe(false);
    expect(typeof command!.func).toBe('function');
  });

  it('has url as a required positional arg', () => {
    const urlArg = command!.args.find((arg) => arg.name === 'url');
    expect(urlArg).toBeDefined();
    expect(urlArg!.required).toBe(true);
    expect(urlArg!.positional).toBe(true);
  });

  it('includes key product fields in the output columns', () => {
    expect(PRODUCT_COLUMNS).toEqual(
      expect.arrayContaining([
        'product_url',
        'title',
        'rating_score',
        'current_price_range',
        'shopee_price',
        'shopdora_price',
        'main_image_url',
        'video_url',
        'thumbnail_url',
        'attr_options',
        'spec_options',
        'seller_name',
        'shop_name',
        'shop_url',
        'shop_product_list_url',
        'stock',
      ]),
    );
    expect(command!.columns).toEqual(expect.arrayContaining(PRODUCT_COLUMNS));
  });

  it('marks structured template fields with list metadata', () => {
    const videoField = PRODUCT_FIELDS.find((field) => field.name === 'video_url');
    const thumbnailField = PRODUCT_FIELDS.find((field) => field.name === 'thumbnail_url');
    const attrOptionsField = PRODUCT_FIELDS.find((field) => field.name === 'attr_options');
    const specOptionsField = PRODUCT_FIELDS.find((field) => field.name === 'spec_options');

    expect(videoField).toMatchObject({
      type: 'list',
      fields: [
        { name: 'video_url', type: 'attribute', attribute: 'src', transform: 'absolute_url' },
      ],
    });
    expect(thumbnailField).toMatchObject({
      type: 'list',
      fields: [{ name: 'thumbnail_url', type: 'attribute', attribute: 'src' }],
    });
    expect(attrOptionsField).toMatchObject({
      type: 'list',
      fields: expect.arrayContaining([
        expect.objectContaining({ name: 'image_url', type: 'attribute', attribute: 'src' }),
        expect.objectContaining({ name: 'is_selected', transform: 'selected_class' }),
      ]),
    });
    expect(specOptionsField).toMatchObject({
      type: 'list',
      fields: expect.arrayContaining([
        expect.objectContaining({ name: 'is_selected', transform: 'selected_class' }),
      ]),
    });
  });
});

describe('mergeProductDetails', () => {
  it('fills only missing fields from a later extraction pass', () => {
    expect(
      mergeProductDetails(
        { title: 'Product A', seller_name: '', stock: '' },
        { title: 'Product B', seller_name: 'Shop 1', stock: '99' },
      ),
    ).toEqual({
      title: 'Product A',
      seller_name: 'Shop 1',
      stock: '99',
    });
  });
});

describe('hasMeaningfulProductData', () => {
  it('returns false for empty extraction rows', () => {
    expect(hasMeaningfulProductData({ title: '', seller_name: '' })).toBe(false);
  });

  it('returns true once any mapped product field has content', () => {
    expect(hasMeaningfulProductData({ title: 'Wireless Earbuds' })).toBe(true);
  });
});

describe('bindShopeeProductTab', () => {
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

  it('returns false when no existing browser tab matches the product url', async () => {
    const bindFn = vi.fn(async () => {
      throw new Error('No visible tab matching target');
    });

    await expect(
      bindShopeeProductTab('https://shopee.sg/product-i.1.2', bindFn),
    ).resolves.toBe(false);
  });
});

describe('ensureShopeeProductPage', () => {
  it('reuses the matched tab, clears localStorage, and reloads the product page', async () => {
    const page = {
      goto: vi.fn(async () => {}),
      evaluate: vi.fn(async () => ({ ok: true, host: 'shopee.sg' })),
    } as unknown as import('@jackwener/opencli/types').IPage;
    const bindFn = vi.fn(async () => ({ tabId: 2 }));

    await expect(
      ensureShopeeProductPage(page, 'https://shopee.sg/product-i.1.2', bindFn),
    ).resolves.toBe(true);

    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://shopee.sg', { waitUntil: 'load' });
    expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('localStorage.clear()'));
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://shopee.sg/product-i.1.2', { waitUntil: 'load' });
  });

  it('falls back to clearing the target host and opening the product url when no existing tab is found', async () => {
    const page = {
      goto: vi.fn(async () => {}),
      evaluate: vi.fn(async () => ({ ok: true, host: 'shopee.sg' })),
    } as unknown as import('@jackwener/opencli/types').IPage;
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
