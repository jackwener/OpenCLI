import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { bindTab } from '@jackwener/opencli/browser/daemon-client';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { simulateHumanBehavior, waitRandomDuration } from './shared.js';

const VARIATION_API_PATTERN = '/api/v4/pdp/cart_panel/select_variation_pc';
const VARIANT_GROUP_SELECTOR = '.j7HL5Q';
const VARIANT_CLICK_DELAY_RANGE_MS = [200, 600];
const SHOPEE_API_PRICE_SCALE = 100000;
const VARIANT_SELECTION_TIMEOUT_SECONDS = 2;
const VARIATION_CAPTURE_TIMEOUT_SECONDS = 3;
const SHOPEE_PRODUCT_SKU_TIMEOUT_SECONDS = 10 * 60;
const SHOPEE_WORKSPACE = 'site:shopee';
const MAX_COLLECTION_ATTEMPTS = 2;
const PRODUCT_STOCK_COLUMNS = [
  'product_url',
  'title',
  'shopee_current_price',
  'group_count',
  'group_names',
  'option_labels',
  'sku',
  'stock',
  'stock_source',
];

async function bindCurrentTabCompat(session, _opts = {}) {
  return bindTab(session);
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeShopeeProductUrl(value) {
  const raw = normalizeText(value);
  if (!raw) {
    throw new ArgumentError('A Shopee product URL is required.');
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ArgumentError('Shopee product-sku requires a valid absolute product URL.');
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new ArgumentError('Shopee product-sku only supports http(s) product URLs.');
  }

  if (!/shopee\./i.test(parsed.hostname)) {
    throw new ArgumentError('Shopee product-sku only supports Shopee product URLs.');
  }

  return parsed.toString();
}

function normalizeStockValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : '';
  }

  const text = normalizeText(value);
  if (!text) {
    return '';
  }

  const compact = text.replace(/,/g, '');
  if (/^-?\d+$/.test(compact)) {
    return Number.parseInt(compact, 10);
  }

  return text;
}

function normalizePriceValue(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return '';
    }
    return `$${(value / SHOPEE_API_PRICE_SCALE).toFixed(2)}`;
  }

  const text = normalizeText(value);
  if (!text) {
    return '';
  }

  const compact = text.replace(/\$/g, '').replace(/,/g, '');
  if (/^-?\d+$/.test(compact)) {
    return `$${(Number.parseInt(compact, 10) / SHOPEE_API_PRICE_SCALE).toFixed(2)}`;
  }

  if (/^-?\d+\.\d+$/.test(compact)) {
    return `$${Number.parseFloat(compact).toFixed(2)}`;
  }

  return text;
}

function extractStockFromVariationPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  return normalizeStockValue(
    payload?.data?.stock
    ?? payload?.stock
    ?? '',
  );
}

function extractPriceFromVariationPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  return normalizePriceValue(
    payload?.data?.product_price?.price?.single_value
    ?? payload?.product_price?.price?.single_value
    ?? '',
  );
}

function parseVariationCaptureEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return { payload: null, stock: '', shopee_current_price: '' };
  }

  if ('data' in entry || 'error' in entry || 'message' in entry) {
    return {
      payload: entry,
      stock: extractStockFromVariationPayload(entry),
      shopee_current_price: extractPriceFromVariationPayload(entry),
    };
  }

  const rawPayload = entry.body ?? entry.responsePreview ?? null;
  if (rawPayload && typeof rawPayload === 'object') {
    return {
      payload: rawPayload,
      stock: extractStockFromVariationPayload(rawPayload),
      shopee_current_price: extractPriceFromVariationPayload(rawPayload),
    };
  }

  if (typeof rawPayload === 'string') {
    try {
      const payload = JSON.parse(rawPayload);
      return {
        payload,
        stock: extractStockFromVariationPayload(payload),
        shopee_current_price: extractPriceFromVariationPayload(payload),
      };
    } catch {
      return { payload: null, stock: '', shopee_current_price: '' };
    }
  }

  return { payload: null, stock: '', shopee_current_price: '' };
}

function sortOptionsForTraversal(options) {
  return [...options].sort((left, right) => {
    if (left.selected === right.selected) {
      return left.buttonIndex - right.buttonIndex;
    }
    return left.selected ? 1 : -1;
  });
}

function buildSelectionKey(selectedLabels) {
  return JSON.stringify(
    Array.isArray(selectedLabels)
      ? selectedLabels.map((label) => normalizeText(label))
      : [],
  );
}

function buildStockRow(productUrl, snapshot, stock, shopeeCurrentPrice, stockSource) {
  const selectedLabels = Array.isArray(snapshot?.selectedLabels)
    ? snapshot.selectedLabels.map((label) => normalizeText(label)).filter(Boolean)
    : [];
  const groupNames = Array.isArray(snapshot?.groupNames)
    ? snapshot.groupNames.map((label) => normalizeText(label))
    : [];
  const title = normalizeText(snapshot?.title ?? '');

  return {
    product_url: productUrl,
    title,
    shopee_current_price: shopeeCurrentPrice,
    group_count: Array.isArray(snapshot?.groups) ? snapshot.groups.length : 0,
    group_names: JSON.stringify(groupNames),
    option_labels: JSON.stringify(selectedLabels),
    sku: selectedLabels.join(' / '),
    stock,
    stock_source: stockSource,
  };
}

function upsertStockRow(rowsByKey, row) {
  const key = buildSelectionKey(JSON.parse(row.option_labels));
  const existing = rowsByKey.get(key);
  if (!existing) {
    rowsByKey.set(key, row);
    return;
  }

  const nextHasStock = row.stock !== '';
  const currentHasStock = existing.stock !== '';
  const nextHasPrice = row.shopee_current_price !== '';
  const currentHasPrice = existing.shopee_current_price !== '';
  const nextIsApi = row.stock_source === 'api';
  const currentIsApi = existing.stock_source === 'api';

  if ((nextHasStock && !currentHasStock) || (nextHasPrice && !currentHasPrice) || (nextIsApi && !currentIsApi)) {
    rowsByKey.set(key, row);
  }
}

async function ensureShopeeProductPage(page, productUrl, bindFn = bindCurrentTabCompat) {
  await bindShopeeProductTab(productUrl, bindFn);
  await page.goto(productUrl, { waitUntil: 'load' });
}

async function bindShopeeProductTab(productUrl, bindFn = bindCurrentTabCompat) {
  try {
    await bindFn(SHOPEE_WORKSPACE, { matchUrl: productUrl });
    return true;
  } catch {
    return false;
  }
}

async function prepareVariationCapture(page) {
  if (typeof page.startNetworkCapture === 'function' && typeof page.readNetworkCapture === 'function') {
    const started = await page.startNetworkCapture(VARIATION_API_PATTERN);
    if (started) {
      return 'native';
    }
  }

  return 'interceptor';
}

function buildInspectVariantStateScript() {
  return `
    (() => {
      const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const extractTitle = () => {
        const target = document.querySelector('h1.vR6K3w > span, h1.vR6K3w');
        if (!(target instanceof Element)) return '';
        const clone = target.cloneNode(true);
        if (clone instanceof Element) {
          clone.querySelectorAll('button').forEach((node) => node.remove());
          return normalizeText(clone.textContent || '');
        }
        return normalizeText(target.textContent || '');
      };
      const groups = Array.from(document.querySelectorAll(${JSON.stringify(VARIANT_GROUP_SELECTOR)}))
        .map((group, groupIndex) => {
          const section = group.closest('section');
          const groupName = normalizeText(section?.querySelector('h2')?.textContent || '') || 'Option ' + (groupIndex + 1);
          const options = Array.from(group.querySelectorAll('button'))
            .map((button, buttonIndex) => {
              const ariaDisabled = normalizeText(button.getAttribute('aria-disabled') || '').toLowerCase();
              const label = normalizeText(
                button.getAttribute('aria-label')
                || button.querySelector('.ZivAAW')?.textContent
                || button.textContent
                || '',
              );
              return {
                buttonIndex,
                label,
                ariaLabel: normalizeText(button.getAttribute('aria-label') || ''),
                disabled: ariaDisabled === 'true' || button.hasAttribute('disabled'),
                selected: /selection-box-selected/.test(button.className || ''),
              };
            })
            .filter((option) => option.label);

          return { groupIndex, groupName, options };
        })
        .filter((group) => group.options.length > 0);

      const selectedLabels = groups
        .map((group) => group.options.find((option) => option.selected)?.label || '')
        .filter(Boolean);

      const quantitySection = Array.from(document.querySelectorAll('section'))
        .find((section) => /数量|quantity/i.test(normalizeText(section.querySelector('h2')?.textContent || '')));
      const quantityText = normalizeText(quantitySection?.textContent || '');
      const stockMatch =
        quantityText.match(/还剩\\s*([\\d,]+)\\s*件/i)
        || quantityText.match(/([\\d,]+)\\s*(?:pieces?|pcs?)\\s*(?:left|available)/i)
        || quantityText.match(/(?:left|available)\\s*[:：]?\\s*([\\d,]+)/i);

      return {
        title: extractTitle(),
        groups,
        groupNames: groups.map((group) => group.groupName),
        selectedLabels,
        visibleStock: stockMatch ? stockMatch[1] : '',
        visibleStockText: quantityText,
      };
    })()
  `;
}

function buildClickVariantOptionScript(groupIndex, buttonIndex) {
  return `
    (() => {
      const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const groups = Array.from(document.querySelectorAll(${JSON.stringify(VARIANT_GROUP_SELECTOR)}));
      const group = groups[${groupIndex}];
      if (!(group instanceof HTMLElement)) {
        return { ok: false, error: 'group_not_found' };
      }

      const buttons = Array.from(group.querySelectorAll('button'));
      const button = buttons[${buttonIndex}];
      if (!(button instanceof HTMLElement)) {
        return { ok: false, error: 'button_not_found' };
      }

      const label = normalizeText(
        button.getAttribute('aria-label')
        || button.querySelector('.ZivAAW')?.textContent
        || button.textContent
        || '',
      );
      const disabled = (button.getAttribute('aria-disabled') || '').toLowerCase() === 'true' || button.hasAttribute('disabled');
      const alreadySelected = /selection-box-selected/.test(button.className || '');

      if (disabled) {
        return { ok: false, error: 'button_disabled', label };
      }

      button.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
      const rect = button.getBoundingClientRect();
      const clientX = Math.round(rect.left + Math.max(1, rect.width / 2));
      const clientY = Math.round(rect.top + Math.max(1, rect.height / 2));
      const mouseInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX,
        clientY,
        button: 0,
        view: window,
      };

      for (const type of ['mousemove', 'mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click']) {
        try {
          button.dispatchEvent(new MouseEvent(type, mouseInit));
        } catch {}
      }

      try {
        button.focus({ preventScroll: true });
      } catch {
        try { button.focus(); } catch {}
      }

      try {
        button.click();
      } catch {}

      return { ok: true, label, alreadySelected };
    })()
  `;
}

async function inspectVariantState(page) {
  const result = await page.evaluate(buildInspectVariantStateScript());
  return result && typeof result === 'object'
    ? result
    : {
        title: '',
        groups: [],
        groupNames: [],
        selectedLabels: [],
        visibleStock: '',
        visibleStockText: '',
      };
}

async function readVariationCaptureEntries(page, captureMode) {
  if (captureMode === 'native' && typeof page.readNetworkCapture === 'function') {
    const entries = await page.readNetworkCapture();
    return Array.isArray(entries) ? entries : [];
  }

  const entries = await page.getInterceptedRequests();
  return Array.isArray(entries) ? entries : [];
}

async function drainVariationCaptures(page, captureMode) {
  const entries = await readVariationCaptureEntries(page, captureMode);
  return entries
    .map((entry) => parseVariationCaptureEntry(entry))
    .filter((entry) => entry.payload);
}

async function waitForVariationCapture(page, captureMode, timeoutSeconds = VARIATION_CAPTURE_TIMEOUT_SECONDS) {
  const deadline = Date.now() + (timeoutSeconds * 1000);
  while (Date.now() < deadline) {
    const captures = await drainVariationCaptures(page, captureMode);
    if (captures.length > 0) {
      return captures[captures.length - 1];
    }
    await page.wait(0.2);
  }
  return null;
}

async function waitForSelectedLabel(page, groupIndex, expectedLabel, timeoutSeconds = VARIANT_SELECTION_TIMEOUT_SECONDS) {
  const wanted = normalizeText(expectedLabel);
  const deadline = Date.now() + (timeoutSeconds * 1000);

  while (Date.now() < deadline) {
    const state = await inspectVariantState(page);
    const actual = normalizeText(state?.groups?.[groupIndex]?.options?.find((option) => option.selected)?.label || '');
    if (actual === wanted) {
      return state;
    }
    await page.wait(0.2);
  }

  return inspectVariantState(page);
}

async function waitBeforeVariantClick(page) {
  await waitRandomDuration(page, VARIANT_CLICK_DELAY_RANGE_MS);
}

async function clickVariantOption(page, groupIndex, buttonIndex) {
  const result = await page.evaluate(buildClickVariantOptionScript(groupIndex, buttonIndex));
  return result && typeof result === 'object'
    ? result
    : { ok: false, error: 'unknown_error' };
}

async function recordCurrentSelection(page, productUrl, rowsByKey, preferredCapture = null) {
  const snapshot = await inspectVariantState(page);
  const hasGroups = Array.isArray(snapshot?.groups) && snapshot.groups.length > 0;
  if (hasGroups && snapshot.selectedLabels.length !== snapshot.groups.length) {
    return false;
  }

  const apiStock = preferredCapture?.stock ?? '';
  const apiPrice = preferredCapture?.shopee_current_price ?? '';
  const domStock = normalizeStockValue(snapshot?.visibleStock ?? '');
  const stock = apiStock !== '' ? apiStock : domStock;
  const stockSource = apiStock !== '' ? 'api' : domStock !== '' ? 'dom' : '';
  const row = buildStockRow(productUrl, snapshot, stock, apiPrice, stockSource);
  upsertStockRow(rowsByKey, row);
  return true;
}

async function collectVariantRows(page, productUrl, captureMode, rowsByKey, groupIndex = 0) {
  const state = await inspectVariantState(page);
  const groups = Array.isArray(state?.groups) ? state.groups : [];

  if (groups.length === 0 || groupIndex >= groups.length) {
    await recordCurrentSelection(page, productUrl, rowsByKey);
    return;
  }

  const group = groups[groupIndex];
  const enabledOptions = sortOptionsForTraversal(
    Array.isArray(group?.options)
      ? group.options.filter((option) => option && option.disabled !== true)
      : [],
  );

  for (const option of enabledOptions) {
    await drainVariationCaptures(page, captureMode);
    await waitBeforeVariantClick(page);

    const clickResult = await clickVariantOption(page, groupIndex, option.buttonIndex);
    if (!clickResult?.ok) {
      continue;
    }

    if (!clickResult.alreadySelected) {
      await waitForSelectedLabel(page, groupIndex, option.label);
    }

    const capture = clickResult.alreadySelected
      ? null
      : await waitForVariationCapture(page, captureMode, VARIATION_CAPTURE_TIMEOUT_SECONDS);

    const nextState = await inspectVariantState(page);
    const nextGroups = Array.isArray(nextState?.groups) ? nextState.groups : [];
    if (nextGroups.length === 0 || groupIndex + 1 >= nextGroups.length) {
      await recordCurrentSelection(page, productUrl, rowsByKey, capture);
      continue;
    }

    await collectVariantRows(page, productUrl, captureMode, rowsByKey, groupIndex + 1);
  }
}

async function collectVariantRowsOnce(page, productUrl, captureMode) {
  await page.wait({ selector: `${VARIANT_GROUP_SELECTOR} button, section.OaFP0p`, timeout: 8 }).catch(() => undefined);
  await simulateHumanBehavior(page, {
    selector: `${VARIANT_GROUP_SELECTOR} button, section.OaFP0p`,
    scrollRangePx: [120, 260],
    preWaitRangeMs: [280, 700],
    postWaitRangeMs: [220, 650],
  });

  await page.wait(1);
  const initialCaptures = await drainVariationCaptures(page, captureMode);
  const rowsByKey = new Map();

  if (initialCaptures.length > 0) {
    await recordCurrentSelection(page, productUrl, rowsByKey, initialCaptures[initialCaptures.length - 1]);
  }

  await collectVariantRows(page, productUrl, captureMode, rowsByKey, 0);
  return [...rowsByKey.values()].filter((row) => row.stock !== '' || row.sku !== '' || row.group_count === 0);
}

cli({
  site: 'shopee',
  name: 'product-sku',
  access: 'read',
  description: 'Get Shopee SKU stock by clicking enabled variation buttons on a product page',
  domain: 'shopee.sg',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  timeoutSeconds: SHOPEE_PRODUCT_SKU_TIMEOUT_SECONDS,
  args: [
    {
      name: 'url',
      positional: true,
      required: true,
      help: 'Shopee product URL, e.g. https://shopee.sg/...-i.123.456',
    },
  ],
  columns: PRODUCT_STOCK_COLUMNS,
  func: async (page, args) => {
    if (!page) {
      throw new CommandExecutionError(
        'Browser session required for shopee product-sku',
        'Run the command with the browser bridge connected',
      );
    }

    const productUrl = normalizeShopeeProductUrl(args.url);
    await ensureShopeeProductPage(page, productUrl);
    const captureMode = await prepareVariationCapture(page);

    if (captureMode === 'interceptor') {
      await page.installInterceptor(VARIATION_API_PATTERN);
    }

    let rows = [];
    for (let attempt = 1; attempt <= MAX_COLLECTION_ATTEMPTS; attempt += 1) {
      rows = await collectVariantRowsOnce(page, productUrl, captureMode);
      if (rows.length > 0) break;
      if (attempt < MAX_COLLECTION_ATTEMPTS) {
        await ensureShopeeProductPage(page, productUrl);
      }
    }

    if (rows.length === 0) {
      throw new EmptyResultError(
        'shopee product-sku',
        'No Shopee SKU stock could be extracted. Check that the product page exposes variation buttons and the browser is logged into Shopee.',
      );
    }

    return rows;
  },
});

export const __test__ = {
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
};
