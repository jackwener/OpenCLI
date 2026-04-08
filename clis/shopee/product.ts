import {
  CliError,
  CommandExecutionError,
  EmptyResultError,
} from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';

type ShopeeField = {
  name: string;
  selector: string;
  type?: 'text' | 'attribute';
  attribute?: string;
};

const PRODUCT_FIELDS: ShopeeField[] = [
  { name: 'title', selector: 'h1.vR6K3w > span' },
  { name: 'rating_score', selector: 'div.F9RHbS.dQEiAI' },
  { name: 'rating_count_text', selector: 'button.flex.e2p50f:nth-of-type(2) > .F9RHbS' },
  { name: 'sold_count_text', selector: '.aleSBU > .AcmPRb' },
  { name: 'current_price_range', selector: '.shopdoraPirceList span' },
  { name: 'original_price', selector: '.ZA5sW5' },
  { name: 'discount_percentage', selector: '.vms4_3' },
  { name: 'first_variant_name', selector: '.j7HL5Q button:first-of-type span.ZivAAW' },
  {
    name: 'first_variant_image_url',
    selector: '.j7HL5Q button:first-of-type img',
    type: 'attribute',
    attribute: 'src',
  },
  { name: 'first_sku_price', selector: '.t-table__body tr:first-child td:nth-child(2) p' },
  { name: 'product_id', selector: '.detail-info-list:nth-of-type(1) .detail-info-item:nth-of-type(1) .item-main' },
  { name: 'seller_name', selector: '.detail-info-list:nth-of-type(1) .detail-info-item:nth-of-type(2) .item-main' },
  { name: 'seller_source', selector: '.detail-info-list:nth-of-type(1) .detail-info-item:nth-of-type(2) .sellerSourceTips' },
  { name: 'brand_name', selector: '.detail-info-list:nth-of-type(1) .detail-info-item:nth-of-type(3) .item-main' },
  { name: 'category', selector: '.detail-info-list:nth-of-type(2) .detail-info-item:nth-of-type(1) .item-main' },
  { name: 'category_sales_rank', selector: '.detail-info-list:nth-of-type(2) .detail-info-item:nth-of-type(1) .tem-main' },
  { name: 'listing_date', selector: '.detail-info-list:nth-of-type(2) .detail-info-item:nth-of-type(2) .item-main' },
  { name: 'sales_1d_7d', selector: '.detail-info-list:nth-of-type(3) .detail-info-item:nth-of-type(1) .item-main' },
  { name: 'sales_growth_30d', selector: '.detail-info-list:nth-of-type(3) .detail-info-item:nth-of-type(2) .item-main' },
  { name: 'sales_30d', selector: '.detail-info-list:nth-of-type(4) .detail-info-item:nth-of-type(1) .item-main' },
  { name: 'gmv_30d', selector: '.detail-info-list:nth-of-type(4) .detail-info-item:nth-of-type(2) .item-main' },
  { name: 'total_sales', selector: '.detail-info-list:nth-of-type(5) .detail-info-item:nth-of-type(1) .item-main' },
  { name: 'total_gmv', selector: '.detail-info-list:nth-of-type(5) .detail-info-item:nth-of-type(2) .item-main' },
  { name: 'stock', selector: '.detail-info-list:nth-of-type(6) .item-main' },
];

const PRODUCT_COLUMNS = [
  'product_url',
  ...PRODUCT_FIELDS.map((field) => field.name),
];

function normalizeShopeeProductUrl(rawUrl: unknown): string {
  const value = String(rawUrl ?? '').trim();
  if (!value) {
    throw new CliError(
      'ARGUMENT',
      'A Shopee product URL is required.',
      'Pass a URL such as https://shopee.sg/...-i.123.456',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CliError('ARGUMENT', `Invalid URL: ${value}`, 'Pass a valid Shopee product URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CliError(
      'ARGUMENT',
      `Unsupported URL protocol: ${parsed.protocol}`,
      'Pass a valid http(s) Shopee product URL',
    );
  }

  if (!/(\.|^)shopee\./i.test(parsed.hostname)) {
    throw new CliError(
      'ARGUMENT',
      `Unsupported Shopee host: ${parsed.hostname}`,
      'Pass a product URL from shopee.*',
    );
  }

  const productPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (!/-i\.\d+\.\d+/i.test(productPath)) {
    throw new CliError(
      'ARGUMENT',
      'The URL does not look like a Shopee product page.',
      'Pass a product URL such as https://shopee.sg/...-i.123.456',
    );
  }

  return parsed.toString();
}

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

async function extractProductDetails(page: IPage, productUrl: string): Promise<Record<string, unknown>> {
  const script = `
    (() => {
      const fields = ${JSON.stringify(PRODUCT_FIELDS)};
      const normalizeText = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const row = {};

      for (const field of fields) {
        const selector = typeof field.selector === 'string' ? field.selector.trim() : '';
        if (!selector) continue;
        const target = document.querySelector(selector);
        if (!target) {
          row[field.name] = '';
          continue;
        }

        if (field.type === 'attribute') {
          const attrName = typeof field.attribute === 'string' && field.attribute.trim()
            ? field.attribute.trim()
            : target instanceof HTMLAnchorElement
              ? 'href'
              : 'src';
          row[field.name] = target.getAttribute(attrName) || '';
          continue;
        }

        row[field.name] = normalizeText(target.textContent || '');
      }

      return row;
    })()
  `;

  await page.goto(productUrl, { waitUntil: 'load' });
  await page.wait(2);

  let merged: Record<string, unknown> = { product_url: productUrl };
  let lastSnapshot = '';

  for (let round = 0; round < 5; round += 1) {
    const batch = await page.evaluate(script);
    const nextRow = typeof batch === 'object' && batch ? batch as Record<string, unknown> : {};
    merged = mergeProductDetails(merged, nextRow);

    const snapshot = JSON.stringify(merged);
    if (hasMeaningfulProductData(merged) && snapshot === lastSnapshot) {
      return merged;
    }
    lastSnapshot = snapshot;

    if (round < 4) {
      await page.scroll('down', 1200);
      await page.wait(1);
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

    const productUrl = normalizeShopeeProductUrl(args.url);
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
  normalizeShopeeProductUrl,
  mergeProductDetails,
  hasMeaningfulProductData,
};
