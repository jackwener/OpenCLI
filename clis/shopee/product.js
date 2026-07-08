import { CommandExecutionError, EmptyResultError, } from '@jackwener/opencli/errors';
import { bindTab } from '@jackwener/opencli/browser/daemon-client';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { readShopdoraLoginState, simulateHumanBehavior } from './shared.js';
function firstUrlFromSrcset(value) {
    const raw = String(value ?? '').trim();
    if (!raw)
        return '';
    const candidate = raw
        .split(',')
        .map((part) => part.trim())
        .find(Boolean);
    if (!candidate)
        return '';
    return candidate.split(/\s+/)[0]?.trim() ?? '';
}
function pickImageUrlFromAttributes(attributes) {
    const directImageAttributes = [
        'src',
        'data-src',
        'data-lazy-src',
        'data-original',
        'data-img-src',
    ];
    const srcsetImageAttributes = [
        'srcset',
        'data-srcset',
        'data-lazy-srcset',
    ];
    for (const key of directImageAttributes) {
        const value = String(attributes[key] ?? '').trim();
        if (value)
            return value;
    }
    for (const key of srcsetImageAttributes) {
        const value = firstUrlFromSrcset(attributes[key]);
        if (value)
            return value;
    }
    return '';
}
const PRODUCT_FIELDS = [
    { name: 'title', selector: 'h1.vR6K3w > span, h1.vR6K3w', transform: 'remove_buttons' },
    { name: 'rating_score', selector: 'div.F9RHbS.dQEiAI' },
    { name: 'rating_count', selector: 'button.flex.e2p50f:nth-of-type(2) > .F9RHbS' },
    { name: 'sold_count', selector: '.aleSBU > .AcmPRb' },
    { name: 'shopdora_price_range', selector: '.shopdoraPirceList span' },
    { name: 'shopee_current_price', selector: '.jRlVo0 .IZPeQz.B67UQ0' },
    { name: 'shopee_original_price', selector: '.ZA5sW5' },
    { name: 'shopee_discount_percentage', selector: '.vms4_3' },
    {
        name: 'main_image_url',
        selector: '.xxW0BG .HJ5l1F .center.Oj2Oo7 > img.rWN4DK, .xxW0BG .HJ5l1F .center.Oj2Oo7 > img, .UdI7e2 picture img.fMm3P2, .UdI7e2 picture img',
        type: 'attribute',
        attribute: 'src',
        transform: 'image_src',
    },
    {
        name: 'video_urls',
        selector: '.xxW0BG .HJ5l1F .center.Oj2Oo7 video source[src], .xxW0BG .HJ5l1F .center.Oj2Oo7 video[src], .UdI7e2 video source[src], .UdI7e2 video[src], .airUhU .UBG7wZ .YM40Nc video source[src], .airUhU .UBG7wZ .YM40Nc video[src]',
        type: 'list',
        fields: [
            {
                name: 'video_urls',
                selector: '',
                type: 'attribute',
                attribute: 'src',
                transform: 'absolute_url',
            },
        ],
    },
    {
        name: 'thumbnail_urls',
        selector: '.airUhU .UBG7wZ .YM40Nc picture img.raRnQV, .airUhU .UBG7wZ .YM40Nc picture img',
        type: 'list',
        fields: [
            {
                name: 'thumbnail_urls',
                selector: '',
                type: 'attribute',
                attribute: 'src',
                transform: 'image_src',
            },
        ],
    },
    { name: 'first_variant_option_name', selector: '.j7HL5Q button:first-of-type span.ZivAAW' },
    {
        name: 'first_variant_option_image_url',
        selector: '.j7HL5Q button:first-of-type picture, .j7HL5Q button:first-of-type img',
        type: 'attribute',
        attribute: 'src',
        transform: 'image_src',
    },
    {
        name: 'image_variant_options',
        selector: '.j7HL5Q button:has(img)',
        type: 'list',
        fields: [
            { name: 'option_name', selector: '.ZivAAW', type: 'text' },
            { name: 'option_aria_label', selector: '', type: 'attribute', attribute: 'aria-label' },
            { name: 'option_image_url', selector: 'picture, img', type: 'attribute', attribute: 'src', transform: 'image_src' },
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
        name: 'text_variant_options',
        selector: '.j7HL5Q button:not(:has(img))',
        type: 'list',
        fields: [
            { name: 'option_name', selector: '.ZivAAW', type: 'text' },
            { name: 'option_aria_label', selector: '', type: 'attribute', attribute: 'aria-label' },
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
    { name: 'first_sku_display_price', selector: '.t-table__body tr:first-child td:nth-child(2) p' },
    {
        name: 'shopee_item_id',
        selector: '.detail-info',
        type: 'labeled_text',
        lookupLabel: 'Product ID',
        valueSelector: '.item-main',
    },
    {
        name: 'detail_seller_name',
        selector: '.detail-info',
        type: 'labeled_text',
        lookupLabel: 'Seller',
        valueSelector: '.item-main',
    },
    {
        name: 'detail_seller_source',
        selector: '.detail-info',
        type: 'labeled_text',
        lookupLabel: 'Seller',
        valueSelector: '.sellerSourceTips',
    },
    {
        name: 'brand_name',
        selector: '.detail-info',
        type: 'labeled_text',
        lookupLabel: 'Brand',
        valueSelector: '.item-main',
    },
    {
        name: 'category_name',
        selector: '.detail-info',
        type: 'labeled_text',
        lookupLabel: 'Category',
        valueSelector: '.item-main',
    },
    {
        name: 'category_sales_rank',
        selector: '.detail-info',
        type: 'labeled_text',
        lookupLabel: 'Category',
        valueSelector: '.tem-main',
    },
    {
        name: 'listing_date',
        selector: '.detail-info',
        type: 'labeled_text',
        lookupLabel: 'Listing Date',
        valueSelector: '.item-main',
    },
    {
        name: 'sales_1d_7d',
        selector: '.detail-info',
        type: 'labeled_text',
        lookupLabel: 'Last 1d/7d Sales',
        valueSelector: '.item-main',
    },
    {
        name: 'sales_growth_30d',
        selector: '.detail-info',
        type: 'labeled_text',
        lookupLabel: '30-Day Sales Growth',
        valueSelector: '.item-main',
    },
    {
        name: 'sales_30d',
        selector: '.detail-info',
        type: 'labeled_text',
        lookupLabel: '30-Day Sales',
        valueSelector: '.item-main',
    },
    {
        name: 'gmv_30d',
        selector: '.detail-info',
        type: 'labeled_text',
        lookupLabel: '30-Day GMV',
        valueSelector: '.item-main',
    },
    {
        name: 'total_sales',
        selector: '.detail-info',
        type: 'labeled_text',
        lookupLabel: 'Total Sales',
        valueSelector: '.item-main',
    },
    {
        name: 'total_gmv',
        selector: '.detail-info',
        type: 'labeled_text',
        lookupLabel: 'GMV',
        valueSelector: '.item-main',
    },
    {
        name: 'stock',
        selector: '.detail-info',
        type: 'labeled_text',
        lookupLabel: 'Stock',
        valueSelector: '.item-main',
    },
    { name: 'shop_display_name', selector: '#sll2-pdp-product-shop .fV3TIn' },
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
    { name: 'shop_joined_duration', selector: '#sll2-pdp-product-shop .NGzCXN > :nth-child(3) .Cs6w3G' },
    { name: 'shop_listing_count', selector: '#sll2-pdp-product-shop .NGzCXN > :nth-child(4) .Cs6w3G' },
    {
        name: 'shop_product_list_url',
        selector: '#sll2-pdp-product-shop .NGzCXN a.aArpoe',
        type: 'attribute',
        attribute: 'href',
        transform: 'absolute_url',
    },
    { name: 'shop_chat_response_speed', selector: '#sll2-pdp-product-shop .NGzCXN > :nth-child(5) .Cs6w3G' },
    { name: 'shop_follower_count', selector: '#sll2-pdp-product-shop .NGzCXN > :nth-child(6) .Cs6w3G' },
];
const PRODUCT_COLUMNS = [
    'product_url',
    'shopdora_login_message',
    ...PRODUCT_FIELDS.map((field) => field.name),
];
const SHOPEE_WORKSPACE = 'site:shopee';
function mergeProductDetails(current, incoming) {
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
function hasMeaningfulProductData(row) {
    return PRODUCT_FIELDS.some((field) => String(row[field.name] ?? '').trim() !== '');
}
async function bindCurrentTabCompat(session, _opts = {}) {
    return bindTab(session);
}
async function bindShopeeProductTab(productUrl, bindFn = bindCurrentTabCompat) {
    try {
        await bindFn(SHOPEE_WORKSPACE, { matchUrl: productUrl });
        return true;
    }
    catch {
        return false;
    }
}
async function ensureShopeeProductPage(page, productUrl, bindFn = bindCurrentTabCompat) {
    const reusedExistingTab = await bindShopeeProductTab(productUrl, bindFn);
    // Temporarily skip localStorage clearing while debugging the Shopee flow.
    // await clearLocalStorageForUrlHost(page, productUrl);
    await page.goto(productUrl, { waitUntil: 'load' });
    return reusedExistingTab;
}
async function extractProductDetails(page, productUrl) {
    const baseOrigin = new URL(productUrl).origin;
    const script = `
    (() => {
      const fields = ${JSON.stringify(PRODUCT_FIELDS)};
      const baseOrigin = ${JSON.stringify(baseOrigin)};
      const normalizeText = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const normalizeLabel = (value) => normalizeText(value).replace(/[:：]/g, '');
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
        if (field.transform === 'remove_buttons' && value instanceof Element) {
          const clone = value.cloneNode(true);
          if (clone instanceof Element) {
            clone.querySelectorAll('button').forEach((node) => node.remove());
            return normalizeText(clone.textContent || '');
          }
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
      const pickTargets = (scope, selector) => {
        if (!selector) return [scope];
        try {
          const targets = Array.from(scope.querySelectorAll(selector));
          return targets.length ? targets : [];
        } catch {
          return [];
        }
      };
      const extractFieldValue = (scope, field) => {
        const selector = typeof field.selector === 'string' ? field.selector.trim() : '';

        if (field.type === 'labeled_text') {
          const root = selector ? scope.querySelector(selector) : scope;
          if (!(root instanceof Element || root instanceof Document)) return '';

          const label = normalizeLabel(field.lookupLabel || '');
          if (!label) return '';

          const candidates = Array.from(root.querySelectorAll('.detail-info-item'));
          for (const item of candidates) {
            const titleNode = item.querySelector('.detail-info-item-title');
            if (!titleNode) continue;
            if (normalizeLabel(titleNode.textContent || '') !== label) continue;

            const valueTarget = field.valueSelector
              ? item.querySelector(field.valueSelector)
              : item.querySelector('.detail-info-item-main');
            const value = normalizeText(valueTarget?.textContent || '');
            if (value) return value;
          }

          return '';
        }

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

        if (field.type === 'attribute') {
          const targets = pickTargets(scope, selector);
          for (const target of targets) {
            if (!(target instanceof Element)) continue;
            if (field.transform === 'image_src') {
              const value = extractImageUrl(target);
              if (value) return value;
              continue;
            }
            const attrName = typeof field.attribute === 'string' && field.attribute.trim()
              ? field.attribute.trim()
              : target instanceof HTMLAnchorElement
                ? 'href'
                : 'src';
            const value = toScalar(applyTransform(target.getAttribute(attrName) || '', field));
            if (value) return value;
          }
          return '';
        }

        const targets = pickTargets(scope, selector);
        for (const target of targets) {
          if (!(target instanceof Element || target instanceof Document)) continue;
          const rawValue = field.transform === 'remove_buttons'
            ? applyTransform(target, field)
            : applyTransform(target.textContent || '', field);
          const value = normalizeText(rawValue);
          if (value) return value;
        }

        return '';
      };
      const row = {};

      for (const field of fields) {
        row[field.name] = extractFieldValue(document, field);
      }

      return row;
    })()
  `;
    let merged = { product_url: productUrl };
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
        const nextRow = typeof batch === 'object' && batch ? batch : {};
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
    access: 'read',
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
            throw new CommandExecutionError('Browser session required for shopee product', 'Run the command with the browser bridge connected');
        }
        const productUrl = args.url;
        await ensureShopeeProductPage(page, productUrl);
        const shopdoraLoginState = await readShopdoraLoginState(page);
        const row = await extractProductDetails(page, productUrl);
        row.shopdora_login_message = shopdoraLoginState.loginMessage;
        if (!hasMeaningfulProductData(row)) {
            throw new EmptyResultError('shopee product', 'The product page did not expose any data. Check that the URL is reachable and the browser is logged into Shopee if needed.');
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
