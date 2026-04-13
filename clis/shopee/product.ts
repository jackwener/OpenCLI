import {
  CommandExecutionError,
  EmptyResultError,
} from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { bindCurrentTab } from '../../src/browser/daemon-client.js';
import { clearLocalStorageForUrlHost, simulateHumanBehavior } from './shared.js';

type ShopeeField = {
  name: string;
  selector: string;
  type?: 'text' | 'attribute' | 'list';
  attribute?: string;
  fields?: ShopeeField[];
  transform?: 'absolute_url' | 'selected_class' | 'image_src';
};

const DIRECT_IMAGE_ATTRIBUTES = [
  'src',
  'data-src',
  'data-lazy-src',
  'data-original',
  'data-img-src',
] as const;

const SRCSET_IMAGE_ATTRIBUTES = [
  'srcset',
  'data-srcset',
  'data-lazy-srcset',
] as const;

function firstUrlFromSrcset(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const candidate = raw
    .split(',')
    .map((part) => part.trim())
    .find(Boolean);
  if (!candidate) return '';
  return candidate.split(/\s+/)[0]?.trim() ?? '';
}

function pickImageUrlFromAttributes(
  attributes: Partial<Record<typeof DIRECT_IMAGE_ATTRIBUTES[number] | typeof SRCSET_IMAGE_ATTRIBUTES[number], unknown>>,
): string {
  for (const key of DIRECT_IMAGE_ATTRIBUTES) {
    const value = String(attributes[key] ?? '').trim();
    if (value) return value;
  }

  for (const key of SRCSET_IMAGE_ATTRIBUTES) {
    const value = firstUrlFromSrcset(attributes[key]);
    if (value) return value;
  }

  return '';
}

const PRODUCT_FIELDS: ShopeeField[] = [
  { name: 'title', selector: 'h1.vR6K3w > span' },
  { name: 'rating_score', selector: 'div.F9RHbS.dQEiAI' },
  { name: 'rating_count_text', selector: 'button.flex.e2p50f:nth-of-type(2) > .F9RHbS' },
  { name: 'sold_count_text', selector: '.aleSBU > .AcmPRb' },
  { name: 'current_price_range', selector: '.shopdoraPirceList span' },
  { name: 'shopee_price', selector: '.jRlVo0 .IZPeQz.B67UQ0' },
  { name: 'shopdora_price', selector: '.shopdoraPirceList span' },
  { name: 'original_price', selector: '.ZA5sW5' },
  { name: 'discount_percentage', selector: '.vms4_3' },
  {
    name: 'main_image_url',
    selector: '.xxW0BG .HJ5l1F .center.Oj2Oo7 > img.rWN4DK, .xxW0BG .HJ5l1F .center.Oj2Oo7 > img, .UdI7e2 picture img.fMm3P2, .UdI7e2 picture img',
    type: 'attribute',
    attribute: 'src',
    transform: 'image_src',
  },
  {
    name: 'video_url',
    selector: '.xxW0BG .HJ5l1F .center.Oj2Oo7 video source[src], .xxW0BG .HJ5l1F .center.Oj2Oo7 video[src], .UdI7e2 video source[src], .UdI7e2 video[src], .airUhU .UBG7wZ .YM40Nc video source[src], .airUhU .UBG7wZ .YM40Nc video[src]',
    type: 'list',
    fields: [
      {
        name: 'video_url',
        selector: '',
        type: 'attribute',
        attribute: 'src',
        transform: 'absolute_url',
      },
    ],
  },
  {
    name: 'thumbnail_url',
    selector: '.airUhU .UBG7wZ .YM40Nc picture img.raRnQV, .airUhU .UBG7wZ .YM40Nc picture img',
    type: 'list',
    fields: [
      {
        name: 'thumbnail_url',
        selector: '',
        type: 'attribute',
        attribute: 'src',
        transform: 'image_src',
      },
    ],
  },
  { name: 'first_variant_name', selector: '.j7HL5Q button:first-of-type span.ZivAAW' },
  {
    name: 'first_variant_image_url',
    selector: '.j7HL5Q button:first-of-type picture, .j7HL5Q button:first-of-type img',
    type: 'attribute',
    attribute: 'src',
    transform: 'image_src',
  },
  {
    name: 'attr_options',
    selector: '.j7HL5Q button:has(img)',
    type: 'list',
    fields: [
      { name: 'name', selector: '.ZivAAW', type: 'text' },
      { name: 'title', selector: '.ZivAAW', type: 'text' },
      { name: 'label', selector: '', type: 'attribute', attribute: 'aria-label' },
      { name: 'image_url', selector: 'picture, img', type: 'attribute', attribute: 'src', transform: 'image_src' },
      { name: 'is_disabled', selector: '', type: 'attribute', attribute: 'aria-disabled' },
      {
        name: 'is_selected',
        selector: '',
        type: 'attribute',
        attribute: 'class',
        transform: 'selected_class',
      },
    ],
  },
  {
    name: 'spec_options',
    selector: '.j7HL5Q button:not(:has(img))',
    type: 'list',
    fields: [
      { name: 'name', selector: '.ZivAAW', type: 'text' },
      { name: 'title', selector: '.ZivAAW', type: 'text' },
      { name: 'label', selector: '', type: 'attribute', attribute: 'aria-label' },
      { name: 'is_disabled', selector: '', type: 'attribute', attribute: 'aria-disabled' },
      {
        name: 'is_selected',
        selector: '',
        type: 'attribute',
        attribute: 'class',
        transform: 'selected_class',
      },
    ],
  },
  { name: 'first_sku_price', selector: '.t-table__body tr:first-child td:nth-child(2) p' },
  {
    name: 'product_title',
    selector: '.detail-info > .detail-info-list:nth-child(1) > .detail-info-item:nth-child(2) .detail-info-item-main, .detail-info > .detail-info-list:nth-child(1) > .detail-info-item:nth-child(2) .item-main.cursor, .detail-info > .detail-info-list:nth-child(1) > .detail-info-item:nth-child(2) .item-main',
  },

  { name: 'product_id', selector: '.detail-info-list:nth-of-type(1) .detail-info-item:nth-of-type(1) .item-main' },
  { name: 'seller_name', selector: '.detail-info-list:nth-of-type(1) .detail-info-item:nth-of-type(2) .item-main' },
  { name: 'seller_source', selector: '.detail-info-list:nth-of-type(1) .detail-info-item:nth-of-type(2) .sellerSourceTips' },
  { name: 'brand_name', selector: '.detail-info-list:nth-of-type(1) .detail-info-item:nth-of-type(3) .item-main' },
  { name: 'category', selector: '.detail-info-list:nth-of-type(2) .detail-info-item:nth-of-type(1) .item-main' },
  { name: 'category_sales_rank', selector: '.detail-info-list:nth-of-type(2) .detail-info-item:nth-of-type(1) .tem-main' },

  { name: 'listing_date', selector: '.detail-info-list:nth-of-type(2) .detail-info-item:nth-of-type(2) .item-main' },
  {
    name: 'sales_1d_7d',
    selector: '.detail-info > .detail-info-list:nth-child(4) > .detail-info-item:nth-child(1) .detail-info-item-main, .detail-info > .detail-info-list:nth-child(4) > .detail-info-item:nth-child(1) .item-main',
  },
  { name: 'sales_growth_30d', selector: '.detail-info-list:nth-of-type(3) .detail-info-item:nth-of-type(2) .item-main' },
  { name: 'sales_30d', selector: '.detail-info-list:nth-of-type(4) .detail-info-item:nth-of-type(1) .item-main' },
  { name: 'gmv_30d', selector: '.detail-info-list:nth-of-type(4) .detail-info-item:nth-of-type(2) .item-main' },
  { name: 'total_sales', selector: '.detail-info-list:nth-of-type(5) .detail-info-item:nth-of-type(1) .item-main' },
  { name: 'total_gmv', selector: '.detail-info-list:nth-of-type(5) .detail-info-item:nth-of-type(2) .item-main' },
  { name: 'stock', selector: '.detail-info-list:nth-of-type(6) .item-main' },
  { name: 'shop_name', selector: '#sll2-pdp-product-shop .fV3TIn' },
  {
    name: 'shop_url',
    selector: '#sll2-pdp-product-shop a.lG5Xxv',
    type: 'attribute',
    attribute: 'href',
    transform: 'absolute_url',
  },
  {
    name: 'shop_logo_url',
    selector: '#sll2-pdp-product-shop .uLQaPg picture img.Qm507c, #sll2-pdp-product-shop .uLQaPg picture img',
    type: 'attribute',
    attribute: 'src',
    transform: 'image_src',
  },
  { name: 'shop_last_active', selector: '#sll2-pdp-product-shop .mMlpiZ .Fsv0YO' },
  { name: 'shop_rating_count', selector: '#sll2-pdp-product-shop .NGzCXN > :nth-child(1) .Cs6w3G' },
  { name: 'shop_chat_response_rate', selector: '#sll2-pdp-product-shop .NGzCXN > :nth-child(2) .Cs6w3G' },
  { name: 'shop_joined_time', selector: '#sll2-pdp-product-shop .NGzCXN > :nth-child(3) .Cs6w3G' },
  { name: 'shop_product_count', selector: '#sll2-pdp-product-shop .NGzCXN > :nth-child(4) .Cs6w3G' },
  {
    name: 'shop_product_list_url',
    selector: '#sll2-pdp-product-shop .NGzCXN a.aArpoe',
    type: 'attribute',
    attribute: 'href',
    transform: 'absolute_url',
  },
  { name: 'shop_response_speed', selector: '#sll2-pdp-product-shop .NGzCXN > :nth-child(5) .Cs6w3G' },
  { name: 'shop_follower_count', selector: '#sll2-pdp-product-shop .NGzCXN > :nth-child(6) .Cs6w3G' },
];

const PRODUCT_COLUMNS = [
  'product_url',
  ...PRODUCT_FIELDS.map((field) => field.name),
];

const SHOPEE_WORKSPACE = 'site:shopee';

type BindCurrentTabFn = (
  workspace: string,
  opts?: { matchDomain?: string; matchPathPrefix?: string; matchUrl?: string },
) => Promise<unknown>;

function mergeProductDetails(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    const nextValue = String(value ?? '').trim();
    const currentValue = String(merged[key] ?? '').trim();
    if (!currentValue && nextValue) {
      merged[key] = value;
    }
  }
  return merged;
}

function hasMeaningfulProductData(row: Record<string, unknown>): boolean {
  return PRODUCT_FIELDS.some((field) => String(row[field.name] ?? '').trim() !== '');
}

async function bindShopeeProductTab(
  productUrl: string,
  bindFn: BindCurrentTabFn = bindCurrentTab,
): Promise<boolean> {
  try {
    await bindFn(SHOPEE_WORKSPACE, { matchUrl: productUrl });
    return true;
  } catch {
    return false;
  }
}

async function ensureShopeeProductPage(
  page: IPage,
  productUrl: string,
  bindFn: BindCurrentTabFn = bindCurrentTab,
): Promise<boolean> {
  const reusedExistingTab = await bindShopeeProductTab(productUrl, bindFn);
  await clearLocalStorageForUrlHost(page, productUrl);
  await page.goto(productUrl, { waitUntil: 'load' });
  return reusedExistingTab;
}

async function extractProductDetails(page: IPage, productUrl: string): Promise<Record<string, unknown>> {
  const baseOrigin = new URL(productUrl).origin;
  const script = `
    (() => {
      const fields = ${JSON.stringify(PRODUCT_FIELDS)};
      const baseOrigin = ${JSON.stringify(baseOrigin)};
      const normalizeText = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const toScalar = (value) => {
        if (value === null || value === undefined) return '';
        return typeof value === 'string' ? value.trim() : String(value);
      };
      const applyTransform = (value, field) => {
        if (field.transform === 'absolute_url') {
          const text = toScalar(value);
          return text.startsWith('/') ? baseOrigin + text : text;
        }
        if (field.transform === 'image_src') {
          return toScalar(value);
        }
        if (field.transform === 'selected_class') {
          return /selection-box-selected/.test(toScalar(value)) ? 'true' : 'false';
        }
        return value;
      };
      const firstUrlFromSrcset = ${firstUrlFromSrcset.toString()};
      const pickImageUrlFromAttributes = ${pickImageUrlFromAttributes.toString()};
      const extractImageUrl = (target) => {
        const candidates = [target];
        if (typeof target?.querySelector === 'function') {
          candidates.push(
            target.querySelector('img'),
            target.querySelector('picture img'),
            target.querySelector('source'),
            target.querySelector('picture source'),
          );
        }

        for (const node of candidates) {
          if (!(node instanceof Element)) continue;
          const attrs = {
            src: node.getAttribute('src') || '',
            'data-src': node.getAttribute('data-src') || '',
            'data-lazy-src': node.getAttribute('data-lazy-src') || '',
            'data-original': node.getAttribute('data-original') || '',
            'data-img-src': node.getAttribute('data-img-src') || '',
            srcset: node.getAttribute('srcset') || '',
            'data-srcset': node.getAttribute('data-srcset') || '',
            'data-lazy-srcset': node.getAttribute('data-lazy-srcset') || '',
          };
          const value = pickImageUrlFromAttributes(attrs);
          if (value) return value;
        }

        return '';
      };
      const isMeaningfulValue = (value) => {
        if (Array.isArray(value)) return value.some(isMeaningfulValue);
        if (value && typeof value === 'object') {
          return Object.values(value).some(isMeaningfulValue);
        }
        return toScalar(value) !== '';
      };
      const extractFieldValue = (scope, field) => {
        const selector = typeof field.selector === 'string' ? field.selector.trim() : '';

        if (field.type === 'list') {
          if (!selector) return '';
          const itemFields = Array.isArray(field.fields) ? field.fields : [];
          const items = Array.from(scope.querySelectorAll(selector))
            .map((node) => {
              const item = {};
              for (const childField of itemFields) {
                item[childField.name] = extractFieldValue(node, childField);
              }
              return item;
            })
            .filter(isMeaningfulValue);

          if (!items.length) return '';
          if (itemFields.length === 1 && itemFields[0]?.name === field.name) {
            return JSON.stringify(items.map((item) => item[field.name] ?? ''));
          }
          return JSON.stringify(items);
        }

        const target = selector ? scope.querySelector(selector) : scope;
        if (!target) return '';

        if (field.type === 'attribute') {
          if (field.transform === 'image_src') {
            return extractImageUrl(target);
          }
          const attrName = typeof field.attribute === 'string' && field.attribute.trim()
            ? field.attribute.trim()
            : target instanceof HTMLAnchorElement
              ? 'href'
              : 'src';
          return toScalar(applyTransform(target.getAttribute(attrName) || '', field));
        }

        return normalizeText(applyTransform(target.textContent || '', field));
      };
      const row = {};

      for (const field of fields) {
        row[field.name] = extractFieldValue(document, field);
      }

      return row;
    })()
  `;


  let merged: Record<string, unknown> = { product_url: productUrl };
  let lastSnapshot = '';

  for (let round = 0; round < 5; round += 1) {
    if (round === 0) {
      await simulateHumanBehavior(page, {
        selector: 'h1.vR6K3w > span, .shopdoraPirceList span',
        scrollRangePx: [80, 220],
        preWaitRangeMs: [350, 900],
        postWaitRangeMs: [300, 800],
      });
    }

    const batch = await page.evaluate(script);
    const nextRow = typeof batch === 'object' && batch ? batch as Record<string, unknown> : {};
    merged = mergeProductDetails(merged, nextRow);

    const snapshot = JSON.stringify(merged);
    if (hasMeaningfulProductData(merged) && snapshot === lastSnapshot) {
      return merged;
    }
    lastSnapshot = snapshot;

    if (round < 4) {
      await simulateHumanBehavior(page, {
        selector: round < 2 ? '.j7HL5Q button, .detail-info .item-main' : '#sll2-pdp-product-shop',
        scrollRangePx: [900, 1400],
        preWaitRangeMs: [220, 700],
        postWaitRangeMs: [450, 1200],
      });
    }
  }

  return merged;
}

cli({
  site: 'shopee',
  name: 'product',
  description: 'Get Shopee product details from a product URL',
  domain: 'shopee.sg',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    {
      name: 'url',
      positional: true,
      required: true,
      help: 'Shopee product URL, e.g. https://shopee.sg/...-i.123.456',
    },
  ],
  columns: PRODUCT_COLUMNS,
  func: async (page, args) => {
    if (!page) {
      throw new CommandExecutionError(
        'Browser session required for shopee product',
        'Run the command with the browser bridge connected',
      );
    }

    const productUrl = args.url;
    await ensureShopeeProductPage(page, productUrl);
    const row = await extractProductDetails(page, productUrl);

    if (!hasMeaningfulProductData(row)) {
      throw new EmptyResultError(
        'shopee product',
        'The product page did not expose any data. Check that the URL is reachable and the browser is logged into Shopee if needed.',
      );
    }

    return [row];
  },
});

export const __test__ = {
  PRODUCT_COLUMNS,
  PRODUCT_FIELDS,
  mergeProductDetails,
  hasMeaningfulProductData,
  firstUrlFromSrcset,
  pickImageUrlFromAttributes,
  bindShopeeProductTab,
  ensureShopeeProductPage,
};
