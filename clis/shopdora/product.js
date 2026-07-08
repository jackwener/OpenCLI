import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
  getErrorMessage,
} from '@jackwener/opencli/errors';
import { log } from '@jackwener/opencli/logger';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { readShopdoraLoginState, SHOPDORA_NOT_LOGGED_IN_MESSAGE } from '../shopee/shared.js';

const SHOPDORA_PRODUCT_URL = 'https://www.shopdora.com/my/product';
const PRODUCT_SEARCH_API_PATTERN = '/api/product/search';
const RESOLVED_TARGET_ATTRIBUTE = 'data-opencli-shopdora-product-target';
const SEARCH_INPUT_LABEL_TEXTS = ['产品id', '产品ID', 'Product ID', 'Product Id'];
const SEARCH_BUTTON_TEXTS = ['查询', '搜索', 'Search'];
const SEARCH_TARGET_TIMEOUT_SECONDS = 15;
const SEARCH_CAPTURE_TIMEOUT_SECONDS = 15;
const SHOPDORA_API_CAPTURE_ARRAY = '__opencli_shopdora_product_xhr';
const LOG_PREFIX = '[shopdora product]';
const ACTION_WAIT_MIN_SECONDS = 0.5;
const ACTION_WAIT_MAX_SECONDS = 1;
const DEFAULT_SHOPEE_IMAGE_REGION = 'sg';
const SHOPEE_REGION_OPTIONS = [
  { site: 'tw', title: '台湾', domains: ['shopee.tw', 'xiapi.xiapibuy.com'] },
  { site: 'sg', title: '新加坡', domains: ['shopee.sg', 'sg.xiapibuy.com'] },
  { site: 'my', title: '马来西亚', domains: ['shopee.com.my', 'my.xiapibuy.com'] },
  { site: 'ph', title: '菲律宾', domains: ['shopee.ph', 'ph.xiapibuy.com'] },
  { site: 'th', title: '泰国', domains: ['shopee.co.th', 'th.xiapibuy.com'] },
  { site: 'vn', title: '越南', domains: ['shopee.vn', 'vn.xiapibuy.com'] },
  { site: 'br', title: '巴西', domains: ['shopee.com.br', 'br.xiapibuy.com'] },
  { site: 'id', title: '印尼', domains: ['shopee.co.id', 'id.xiapibuy.com'] },
  { site: 'mx', title: '墨西哥', domains: ['shopee.com.mx', 'mx.xiapibuy.com'] },
];

const PRODUCT_COLUMNS = [
  'shopee_url',
  'item_id',
  'shop_id',
  'shop_type',
  'cat_id',
  'name',
  'brand',
  'brand_id',
  'shop_name',
  'price',
  'avg_price',
  'sku_avg_price',
  'avg_sku_avg_price',
  'sales',
  'sales_m',
  'sales_day',
  'sales_7day',
  'sales_amount_m',
  'sales_amount_day',
  'sales_growth_rate_m',
  'sales_amount_growth_rate_m',
  'rating_score',
  'rating_number_total',
  'rating_number_m',
  'rating_rate_total',
  'rating_rate_m',
  'liked_cnt',
  'liked_cnt_m',
  'sku_cnt',
  'seller_source',
  'status',
  'shelf_time',
  'shop_start_time',
  'image_url',
  'cate_rank',
  'cate_rank_change_d',
  'cate_rank_change_w',
  'hot_cluster_id',
  'hot_cluster_name',
  'hot_cluster_rank',
  'hot_cluster_rank_change_w',
  'cate_path',
  'cate_ch_path',
  'monitor',
  'is_collect',
  'shopdora_login_message',
];

function logStep(message) {
  log.status(`${LOG_PREFIX} ${message}`);
}

async function sleep(page, seconds) {
  if (page && typeof page.wait === 'function') {
    await page.wait(seconds);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function sleepAction(page, minSeconds = ACTION_WAIT_MIN_SECONDS, maxSeconds = ACTION_WAIT_MAX_SECONDS) {
  const min = Math.min(minSeconds, maxSeconds);
  const max = Math.max(minSeconds, maxSeconds);
  const duration = min + ((max - min) * Math.random());
  await sleep(page, Number(duration.toFixed(3)));
}

function normalizeShopeeUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    throw new ArgumentError('A Shopee product URL is required.');
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ArgumentError('shopdora product requires a valid absolute Shopee product URL.');
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    throw new ArgumentError('shopdora product only supports http(s) Shopee product URLs.');
  }

  return parsed.toString();
}

function getShopeeRegionOptionFromUrl(shopeeUrl) {
  try {
    const { hostname } = new URL(shopeeUrl);
    const normalized = hostname.toLowerCase();
    return SHOPEE_REGION_OPTIONS.find((option) => (
      option.domains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`))
    )) || null;
  } catch {
    return null;
  }
}

function getShopeeImageRegionFromUrl(shopeeUrl) {
  return getShopeeRegionOptionFromUrl(shopeeUrl)?.site || DEFAULT_SHOPEE_IMAGE_REGION;
}

function normalizeShopdoraImageUrl(value, shopeeUrl = '') {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  if (/^(data|blob):/i.test(raw)) return raw;

  const imageKey = raw
    .replace(/^\/+/, '')
    .replace(/^file\/+/i, '');
  const region = getShopeeImageRegionFromUrl(shopeeUrl);
  return imageKey ? `https://down-${region}.img.susercontent.com/file/${imageKey}` : '';
}

function buildResolveTargetSelectorScript(target) {
  return `
    (() => {
      const target = ${JSON.stringify(target)};
      const attr = ${JSON.stringify(RESOLVED_TARGET_ATTRIBUTE)};
      const labelTexts = ${JSON.stringify(SEARCH_INPUT_LABEL_TEXTS)};
      const buttonTexts = ${JSON.stringify(SEARCH_BUTTON_TEXTS)};
      const regionOptions = ${JSON.stringify(SHOPEE_REGION_OPTIONS)};
      const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const lower = (value) => normalizeText(value).toLowerCase();
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const mark = (name, element) => {
        if (!(element instanceof HTMLElement)) return { ok: false, error: 'target_not_found' };
        element.setAttribute(attr, name);
        return { ok: true, selector: '[' + attr + '="' + name + '"]' };
      };
      const findInputByLabel = () => {
        const wanted = labelTexts.map(lower);
        const candidates = Array.from(document.querySelectorAll('label, .t-form__label, .el-form-item__label, .ant-form-item-label label, .form-label, .label, span, div'));
        for (const element of candidates) {
          if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
          const text = lower(element.textContent);
          if (!text) continue;
          if (!wanted.some((label) => text === label || text.includes(label))) continue;
          const containers = [
            element.closest('.t-form__item'),
            element.closest('.el-form-item'),
            element.closest('.ant-form-item'),
            element.closest('.form-item'),
            element.parentElement,
            element.parentElement?.parentElement,
            element.parentElement?.parentElement?.parentElement,
          ].filter(Boolean);
          for (const container of containers) {
            const input = container?.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled])');
            if (input instanceof HTMLElement && isVisible(input)) return input;
          }
        }

        const fallback = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([disabled]), textarea:not([disabled])'))
          .find((element) => {
            if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
            const joined = lower([
              element.getAttribute('placeholder'),
              element.getAttribute('aria-label'),
              element.getAttribute('name'),
              element.getAttribute('id'),
            ].filter(Boolean).join(' '));
            return wanted.some((label) => joined.includes(label));
          });
        if (fallback instanceof HTMLElement) return fallback;

        const visibleInputs = Array.from(document.querySelectorAll('input[type="text"]:not([disabled]), input:not([type]):not([disabled]), textarea:not([disabled])'))
          .filter((element) => element instanceof HTMLElement && isVisible(element));
        return visibleInputs.length === 1 ? visibleInputs[0] : null;
      };
      const findButtonByText = () => {
        const wanted = buttonTexts.map(lower);
        const candidates = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], .t-button'));
        return candidates.find((element) => {
          if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
          const text = lower(
            element instanceof HTMLInputElement
              ? element.value
              : element.textContent,
          );
          return wanted.some((label) => text === label || text.includes(label));
        }) || null;
      };
      const findRegionRadio = () => {
        if (!target.startsWith('region-radio:')) return null;
        const site = target.slice('region-radio:'.length);
        const allowedSites = regionOptions.map((option) => option.site);
        if (!allowedSites.includes(site)) return null;
        const inputs = Array.from(document.querySelectorAll('input[type="radio"], input.t-radio-button__former'));
        const matchedInput = inputs.find((element) => {
          if (!(element instanceof HTMLInputElement) || element.disabled) return false;
          const value = normalizeText(element.value || element.getAttribute('data-value') || '').replace(/^['"]|['"]$/g, '');
          return value === site;
        });
        const targetElement = matchedInput?.closest('label, .t-radio-button') || matchedInput;
        if (targetElement instanceof HTMLElement && isVisible(targetElement)) return targetElement;
        return null;
      };

      if (target === 'product-id-input') {
        return mark(target, findInputByLabel());
      }

      if (target === 'query-button') {
        return mark(target, findButtonByText());
      }

      if (target.startsWith('region-radio:')) {
        return mark(target, findRegionRadio());
      }

      return { ok: false, error: 'unknown_target' };
    })()
  `;
}

async function tryResolveTargetSelector(page, target) {
  try {
    const result = await page.evaluate(buildResolveTargetSelectorScript(target));
    if (result && typeof result === 'object' && result.ok && typeof result.selector === 'string') {
      return result.selector;
    }
    return '';
  } catch {
    return '';
  }
}

async function waitForResolvedTargetSelector(page, target, label, timeoutSeconds = SEARCH_TARGET_TIMEOUT_SECONDS) {
  const deadline = Date.now() + (timeoutSeconds * 1000);
  while (Date.now() < deadline) {
    const selector = await tryResolveTargetSelector(page, target);
    if (selector) return selector;
    await page.wait(0.25);
  }

  throw new CommandExecutionError(`shopdora product could not resolve ${label}`);
}

function buildSetInputValueScript(selector, value) {
  return `
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      const value = ${JSON.stringify(value)};
      if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) {
        return { ok: false, error: 'input_not_found' };
      }

      try {
        input.focus({ preventScroll: true });
      } catch {
        try { input.focus(); } catch {}
      }

      const prototype = input instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

      if (setter) setter.call(input, value);
      else input.value = value;

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      return { ok: true, value: input.value };
    })()
  `;
}

function buildReadRegionRadioStateScript(selector) {
  return `
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) return { ok: false, checked: false };
      const input = element.matches('input[type="radio"]')
        ? element
        : element.querySelector('input[type="radio"]');
      const checked = input instanceof HTMLInputElement
        ? input.checked
        : element.classList.contains('t-is-checked');
      return { ok: true, checked };
    })()
  `;
}

async function setInputValue(page, selector, value) {
  await sleepAction(page);
  const result = await page.evaluate(buildSetInputValueScript(selector, value));
  if (!result || typeof result !== 'object' || result.ok !== true) {
    throw new CommandExecutionError('shopdora product could not set the product-id input value');
  }
  await sleepAction(page);
}

async function clickSelector(page, selector, label) {
  try {
    await sleepAction(page);
    await page.click(selector);
    await sleepAction(page);
  } catch (error) {
    throw new CommandExecutionError(`shopdora product could not click ${label}`, getErrorMessage(error));
  }
}

async function selectProductRegion(page, shopeeUrl) {
  const option = getShopeeRegionOptionFromUrl(shopeeUrl);
  if (!option?.site) return;
  const selector = await tryResolveTargetSelector(page, `region-radio:${option.site}`);
  if (!selector) {
    throw new CommandExecutionError(`shopdora product could not resolve region selector for ${option.site}`);
  }
  const state = await page.evaluate(buildReadRegionRadioStateScript(selector));
  if (state && typeof state === 'object' && state.checked === true) {
    logStep(`product search region already selected: ${option.site}/${option.title}`);
    return;
  }
  logStep(`selecting product search region: ${option.site}/${option.title}`);
  await clickSelector(page, selector, `${option.title} region radio`);
}

async function runWithFocusedWindow(fn) {
  const previous = process.env.OPENCLI_WINDOW_FOCUSED;
  process.env.OPENCLI_WINDOW_FOCUSED = '1';
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.OPENCLI_WINDOW_FOCUSED;
    } else {
      process.env.OPENCLI_WINDOW_FOCUSED = previous;
    }
  }
}

async function openShopdoraPage(page, url) {
  if (typeof page.newTab === 'function') {
    const created = await runWithFocusedWindow(() => page.newTab(url));
    if (typeof created === 'string' && created) {
      await page.selectTab(created);
      return created;
    }
  }

  await page.goto(url, { waitUntil: 'load' });
  return null;
}

function buildInstallShopdoraApiUrlInterceptorScript() {
  return `
    (() => {
      const arrayName = ${JSON.stringify(SHOPDORA_API_CAPTURE_ARRAY)};
      const guard = '__opencli_shopdora_product_api_url_interceptor_patched';
      const matches = (url) => {
        try {
          const parsed = new URL(String(url || ''), window.location.href);
          return parsed.origin === 'https://www.shopdora.com' && parsed.pathname.startsWith('/api/');
        } catch {
          return false;
        }
      };
      const pushCapture = (url, text, requestBody) => {
        const entry = {
          url: String(url || ''),
          body: String(text || ''),
          requestBody: typeof requestBody === 'string' ? requestBody : '',
        };
        try {
          entry.responsePreview = JSON.parse(entry.body);
        } catch {}
        window[arrayName].push(entry);
      };

      if (!window[arrayName]) {
        try {
          Object.defineProperty(window, arrayName, {
            value: [],
            writable: true,
            enumerable: false,
            configurable: true,
          });
        } catch {
          window[arrayName] = [];
        }
      }

      if (window[guard]) return { ok: true, alreadyInstalled: true };

      const originalFetch = window.fetch;
      window.fetch = async function(...args) {
        const requestUrl = typeof args[0] === 'string'
          ? args[0]
          : args[0] && typeof args[0].url === 'string'
            ? args[0].url
            : '';
        const requestBody = typeof args[1]?.body === 'string' ? args[1].body : '';
        const response = await originalFetch.apply(this, args);
        if (matches(requestUrl)) {
          try {
            const text = await response.clone().text();
            pushCapture(requestUrl, text, requestBody);
          } catch {}
        }
        return response;
      };

      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url) {
        try {
          Object.defineProperty(this, '__opencliShopdoraProductApiUrl', {
            value: String(url || ''),
            writable: true,
            enumerable: false,
            configurable: true,
          });
        } catch {
          this.__opencliShopdoraProductApiUrl = String(url || '');
        }
        return originalOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function(body) {
        if (matches(this.__opencliShopdoraProductApiUrl)) {
          const requestBody = typeof body === 'string' ? body : '';
          this.addEventListener('load', function() {
            try {
              pushCapture(this.__opencliShopdoraProductApiUrl, this.responseText, requestBody);
            } catch {}
          });
        }
        return originalSend.apply(this, arguments);
      };

      try {
        Object.defineProperty(window, guard, {
          value: true,
          writable: true,
          enumerable: false,
          configurable: true,
        });
      } catch {
        window[guard] = true;
      }

      return { ok: true, alreadyInstalled: false };
    })()
  `;
}

async function installShopdoraApiUrlInterceptor(page) {
  if (typeof page?.evaluate !== 'function') return;
  await page.evaluate(buildInstallShopdoraApiUrlInterceptorScript());
}

async function readCapturedShopdoraEntries(page) {
  if (typeof page?.evaluate !== 'function') return [];
  try {
    const entries = await page.evaluate(`
      (() => {
        try {
          return Array.isArray(window.${SHOPDORA_API_CAPTURE_ARRAY}) ? window.${SHOPDORA_API_CAPTURE_ARRAY} : [];
        } catch {
          return [];
        }
      })()
    `);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

function isSuccessfulSearchPayload(payload) {
  return Boolean(
    payload
      && typeof payload === 'object'
      && payload.code === 'ok'
      && payload.data
      && typeof payload.data === 'object'
      && Array.isArray(payload.data.list),
  );
}

function isProductSearchItem(item) {
  return Boolean(
    item
      && typeof item === 'object'
      && !Array.isArray(item)
      && (
        item.itemId !== undefined
        || item.shopId !== undefined
        || item.catId !== undefined
        || item.shopName !== undefined
      ),
  );
}

function isProductSearchPayload(payload) {
  return Boolean(
    isSuccessfulSearchPayload(payload)
      && payload.data.list.some((item) => isProductSearchItem(item)),
  );
}

function parseInterceptedPayload(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if ('code' in entry || 'data' in entry || 'ok' in entry) return entry;

  const rawPayload = entry.body ?? entry.responsePreview ?? null;
  if (rawPayload && typeof rawPayload === 'object') return rawPayload;
  if (typeof rawPayload === 'string') {
    try {
      return JSON.parse(rawPayload);
    } catch {
      return null;
    }
  }
  return null;
}

function readInterceptedEntryUrl(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const candidates = [
    entry.url,
    entry.request?.url,
    entry.response?.url,
  ];
  const first = candidates.find((value) => typeof value === 'string' && value.trim());
  return typeof first === 'string' ? first.trim() : '';
}

function isShopdoraProductSearchUrl(value) {
  try {
    const url = new URL(String(value ?? ''), 'https://www.shopdora.com');
    return url.origin === 'https://www.shopdora.com' && url.pathname === '/api/product/search';
  } catch {
    return false;
  }
}

function isProductSearchEntry(entry) {
  const url = readInterceptedEntryUrl(entry);
  if (url) return isShopdoraProductSearchUrl(url);
  return isProductSearchPayload(parseInterceptedPayload(entry));
}

function extractLatestProductSearchPayload(entries) {
  if (!Array.isArray(entries)) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isProductSearchEntry(entry)) continue;
    const payload = parseInterceptedPayload(entry);
    if (isProductSearchPayload(payload)) return payload;
  }
  return null;
}

function extractLatestExactProductSearchPayload(entries) {
  if (!Array.isArray(entries)) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isShopdoraProductSearchUrl(readInterceptedEntryUrl(entry))) continue;
    const payload = parseInterceptedPayload(entry);
    if (payload && typeof payload === 'object') return payload;
  }
  return null;
}

function summarizeCapturedApiUrls(entries, limit = 12) {
  if (!Array.isArray(entries) || entries.length === 0) return '(none)';
  const urls = entries
    .map((entry) => readInterceptedEntryUrl(entry))
    .filter(Boolean)
    .slice(-limit);
  return urls.length > 0 ? urls.join(', ') : '(no_urls)';
}

function summarizeProductSearchEntries(entries, limit = 3) {
  if (!Array.isArray(entries) || entries.length === 0) return '(none)';
  return entries
    .filter((entry) => isShopdoraProductSearchUrl(readInterceptedEntryUrl(entry)))
    .slice(-limit)
    .map((entry) => {
      const payload = parseInterceptedPayload(entry);
      const list = Array.isArray(payload?.data?.list) ? payload.data.list : [];
      const sample = list[0] && typeof list[0] === 'object' ? Object.keys(list[0]).slice(0, 12).join('|') : '(empty)';
      return `code=${String(payload?.code ?? '')}|rows=${list.length}|sampleKeys=${sample}`;
    })
    .join(', ') || '(none)';
}

async function readAllCapturedEntries(page) {
  return [
    ...(await readCapturedShopdoraEntries(page)),
    ...(typeof page?.getInterceptedRequests === 'function' ? await page.getInterceptedRequests() : []),
  ];
}

async function waitForProductSearchPayload(page, timeoutSeconds = SEARCH_CAPTURE_TIMEOUT_SECONDS) {
  const attempts = Math.max(1, Math.ceil(timeoutSeconds / 0.5));
  let lastEntries = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const entries = await readAllCapturedEntries(page);
    lastEntries = entries;
    logStep(`product/search capture poll ${attempt + 1}/${attempts}: apiUrls=${summarizeCapturedApiUrls(entries)}`);
    const productSummary = summarizeProductSearchEntries(entries);
    if (productSummary !== '(none)') {
      logStep(`product/search payload summary: ${productSummary}`);
    }
    const payload = extractLatestProductSearchPayload(entries);
    if (payload) return { payload, entries };
    await sleep(page, 0.5);
  }
  return { payload: null, entries: lastEntries };
}

function mapProductRecordToRow(item, shopeeUrl, loginMessage) {
  return {
    shopee_url: shopeeUrl,
    item_id: item?.itemId ?? '',
    shop_id: item?.shopId ?? '',
    shop_type: item?.shopType ?? '',
    cat_id: item?.catId ?? '',
    name: item?.name ?? '',
    brand: item?.brand ?? '',
    brand_id: item?.brandId ?? '',
    shop_name: item?.shopName ?? '',
    price: item?.price ?? '',
    avg_price: item?.avgPrice ?? '',
    sku_avg_price: item?.skuAvgPrice ?? '',
    avg_sku_avg_price: item?.avgSkuAvgPrice ?? '',
    sales: item?.sales ?? '',
    sales_m: item?.salesM ?? '',
    sales_day: item?.salesDay ?? '',
    sales_7day: item?.sales7day ?? '',
    sales_amount_m: item?.salesAmountM ?? '',
    sales_amount_day: item?.salesAmountDay ?? '',
    sales_growth_rate_m: item?.salesGrowthRateM ?? '',
    sales_amount_growth_rate_m: item?.salesAmountGrowthRateM ?? '',
    rating_score: item?.ratingScore ?? '',
    rating_number_total: item?.ratingNumberTotal ?? '',
    rating_number_m: item?.ratingNumberM ?? '',
    rating_rate_total: item?.ratingRateTotal ?? '',
    rating_rate_m: item?.ratingRateM ?? '',
    liked_cnt: item?.likedCnt ?? '',
    liked_cnt_m: item?.likedCntM ?? '',
    sku_cnt: item?.skuCnt ?? '',
    seller_source: item?.sellerSource ?? '',
    status: item?.status ?? '',
    shelf_time: item?.shelfTime ?? '',
    shop_start_time: item?.shopStartTime ?? '',
    image_url: normalizeShopdoraImageUrl(item?.imageUrl, shopeeUrl),
    cate_rank: item?.cateRank ?? '',
    cate_rank_change_d: item?.cateRankChangeD ?? '',
    cate_rank_change_w: item?.cateRankChangeW ?? '',
    hot_cluster_id: item?.hotClusterId ?? '',
    hot_cluster_name: item?.hotClusterName ?? '',
    hot_cluster_rank: item?.hotClusterRank ?? '',
    hot_cluster_rank_change_w: item?.hotClusterRankChangeW ?? '',
    cate_path: item?.catePath ?? '',
    cate_ch_path: item?.cateChPath ?? '',
    monitor: item?.monitor ?? false,
    is_collect: item?.isCollect ?? false,
    shopdora_login_message: loginMessage,
  };
}

cli({
  site: 'shopdora',
  name: 'product',
  access: 'read',
  description: 'Query Shopdora product data from a Shopee product URL',
  domain: 'www.shopdora.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    {
      name: 'shopeeUrl',
      positional: true,
      required: true,
      help: 'Shopee product URL, e.g. https://shopee.sg/...-i.123.456',
    },
  ],
  columns: PRODUCT_COLUMNS,
  func: async (page, args) => {
    if (!page) {
      throw new CommandExecutionError(
        'Browser session required for shopdora product',
        'Run the command with the browser bridge connected',
      );
    }

    const shopeeUrl = normalizeShopeeUrl(args.shopeeUrl);
    await openShopdoraPage(page, SHOPDORA_PRODUCT_URL);
    const initialLoginState = await readShopdoraLoginState(page);
    if (initialLoginState.hasShopdoraLoginPage || initialLoginState.hasPageDetailLoginTitle) {
      throw new AuthRequiredError('www.shopdora.com', `${SHOPDORA_NOT_LOGGED_IN_MESSAGE}，请先登录 Shopdora 后重试。`);
    }

    const inputSelector = await waitForResolvedTargetSelector(page, 'product-id-input', 'product-id input');
    const buttonSelector = await waitForResolvedTargetSelector(page, 'query-button', 'query button');

    await page.installInterceptor(PRODUCT_SEARCH_API_PATTERN);
    await installShopdoraApiUrlInterceptor(page);
    await selectProductRegion(page, shopeeUrl);
    await setInputValue(page, inputSelector, shopeeUrl);
    await clickSelector(page, buttonSelector, 'query button');
    if (typeof page.waitForCapture === 'function') {
      await page.waitForCapture(SEARCH_CAPTURE_TIMEOUT_SECONDS);
    }

    const capture = await waitForProductSearchPayload(page, SEARCH_CAPTURE_TIMEOUT_SECONDS);
    const payload = capture.payload;
    const latestExactPayload = extractLatestExactProductSearchPayload(capture.entries);
    if (!payload) {
      if (latestExactPayload && latestExactPayload.code && latestExactPayload.code !== 'ok') {
        throw new CommandExecutionError(
          `shopdora product search failed: ${String(latestExactPayload.errMsg || latestExactPayload.tips || latestExactPayload.enTips || latestExactPayload.code)}`,
          `code=${String(latestExactPayload.code)} url=/api/product/search`,
        );
      }
      throw new CommandExecutionError(
        'shopdora product did not capture a valid /api/product/search response',
        `Captured API URLs: ${summarizeCapturedApiUrls(capture.entries)}. Check that Shopdora is logged in and the product search request still fires from the page.`,
      );
    }

    if (payload.code !== 'ok') {
      throw new CommandExecutionError(
        `shopdora product search failed: ${String(payload.errMsg || payload.tips || payload.enTips || payload.code || 'unknown_error')}`,
      );
    }

    const rows = Array.isArray(payload?.data?.list)
      ? payload.data.list
        .filter((item) => isProductSearchItem(item))
        .map((item) => mapProductRecordToRow(item, shopeeUrl, initialLoginState.loginMessage))
      : [];

    if (rows.length === 0) {
      throw new EmptyResultError(
        'shopdora product',
        'Shopdora returned an empty product list. Check that the Shopee URL is valid and visible in Shopdora.',
      );
    }

    return rows;
  },
});

export const __test__ = {
  SHOPDORA_PRODUCT_URL,
  PRODUCT_SEARCH_API_PATTERN,
  PRODUCT_COLUMNS,
  SHOPEE_REGION_OPTIONS,
  RESOLVED_TARGET_ATTRIBUTE,
  SEARCH_INPUT_LABEL_TEXTS,
  SEARCH_BUTTON_TEXTS,
  normalizeShopeeUrl,
  getShopeeRegionOptionFromUrl,
  getShopeeImageRegionFromUrl,
  normalizeShopdoraImageUrl,
  buildResolveTargetSelectorScript,
  buildSetInputValueScript,
  buildReadRegionRadioStateScript,
  buildInstallShopdoraApiUrlInterceptorScript,
  installShopdoraApiUrlInterceptor,
  readCapturedShopdoraEntries,
  parseInterceptedPayload,
  readInterceptedEntryUrl,
  isShopdoraProductSearchUrl,
  isProductSearchEntry,
  isProductSearchItem,
  isProductSearchPayload,
  extractLatestProductSearchPayload,
  extractLatestExactProductSearchPayload,
  summarizeCapturedApiUrls,
  readAllCapturedEntries,
  waitForProductSearchPayload,
  isSuccessfulSearchPayload,
  mapProductRecordToRow,
  waitForResolvedTargetSelector,
  setInputValue,
  clickSelector,
  selectProductRegion,
  runWithFocusedWindow,
  openShopdoraPage,
};
