import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
} from '@jackwener/opencli/errors';
import { log } from '@jackwener/opencli/logger';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { readShopdoraLoginState, SHOPDORA_NOT_LOGGED_IN_MESSAGE } from '../shopee/shared.js';

const SHOPDORA_HOT_PRODUCT_URL = 'https://www.shopdora.com/my/product#hot';
const PRODUCT_SEARCH_API_PATTERN = '/api/product/search';
const RESOLVED_TARGET_ATTRIBUTE = 'data-opencli-shopdora-search-target';
const SEARCH_KEYWORD_PLACEHOLDERS = ['搜索热门产品', 'Search hot products', 'Search Popular Products'];
const SEARCH_BUTTON_TEXTS = ['查询', '搜索', 'Search'];
const TARGET_TIMEOUT_SECONDS = 15;
const SEARCH_CAPTURE_TIMEOUT_SECONDS = 15;
const SHOPDORA_API_CAPTURE_ARRAY = '__opencli_xhr';
const LOG_PREFIX = '[shopdora search]';
const ACTION_WAIT_MIN_SECONDS = 0.5;
const ACTION_WAIT_MAX_SECONDS = 1;
const REGION_OPTIONS = [
  { site: 'tw', title: '台湾', host: 'shopee.tw' },
  { site: 'sg', title: '新加坡', host: 'shopee.sg' },
  { site: 'my', title: '马来西亚', host: 'shopee.com.my' },
  { site: 'ph', title: '菲律宾', host: 'shopee.ph' },
  { site: 'th', title: '泰国', host: 'shopee.co.th' },
  { site: 'vn', title: '越南', host: 'shopee.vn' },
  { site: 'br', title: '巴西', host: 'shopee.com.br' },
  { site: 'id', title: '印尼', host: 'shopee.co.id' },
  { site: 'mx', title: '墨西哥', host: 'shopee.com.mx', aliases: ['mc'] },
];

const OUTPUT_COLUMNS = [];

function normalizeKeyword(value) {
  const keyword = String(value ?? '').trim();
  if (!keyword) {
    throw new ArgumentError('A Shopdora search keyword is required.');
  }
  return keyword;
}

function normalizeRegion(value = 'sg') {
  const raw = String(value ?? 'sg').trim().toLowerCase();
  const normalized = raw === 'mc' ? 'mx' : raw;
  const option = REGION_OPTIONS.find((item) => (
    item.site === normalized || (Array.isArray(item.aliases) && item.aliases.includes(raw))
  ));
  if (!option) {
    throw new ArgumentError('Unsupported Shopdora region. Use one of: sg,my,tw,ph,th,vn,br,id,mx,mc.');
  }
  return option.site;
}

function getRegionOption(site) {
  return REGION_OPTIONS.find((item) => item.site === normalizeRegion(site)) || REGION_OPTIONS[1];
}

function buildShopeeProductUrl(item, site) {
  const option = getRegionOption(site);
  const shopId = String(item?.shopId ?? '').trim();
  const itemId = String(item?.itemId ?? '').trim();
  if (!shopId || !itemId) return '';
  return `https://${option.host}/product/${shopId}/${itemId}`;
}

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

function buildResolveTargetSelectorScript(target) {
  return `
    (() => {
      const target = ${JSON.stringify(target)};
      const attr = ${JSON.stringify(RESOLVED_TARGET_ATTRIBUTE)};
      const placeholders = ${JSON.stringify(SEARCH_KEYWORD_PLACEHOLDERS)};
      const buttonTexts = ${JSON.stringify(SEARCH_BUTTON_TEXTS)};
      const regionOptions = ${JSON.stringify(REGION_OPTIONS)};
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
      const findKeywordInput = () => {
        const wanted = placeholders.map(lower);
        const exact = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([disabled]), textarea:not([disabled])'))
          .find((element) => {
            if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
            const placeholder = lower(element.getAttribute('placeholder'));
            return wanted.some((item) => placeholder === item);
          });
        if (exact instanceof HTMLElement) return exact;

        const partial = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([disabled]), textarea:not([disabled])'))
          .find((element) => {
            if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
            const joined = lower([
              element.getAttribute('placeholder'),
              element.getAttribute('aria-label'),
              element.getAttribute('name'),
              element.getAttribute('id'),
            ].filter(Boolean).join(' '));
            return wanted.some((item) => joined.includes(item) || item.includes(joined));
          });
        if (partial instanceof HTMLElement) return partial;

        return null;
      };
      const findQueryButton = () => {
        const wanted = buttonTexts.map(lower);
        const input = findKeywordInput();
        const containers = [
          input?.closest('form'),
          input?.closest('.t-form'),
          input?.closest('.search-form'),
          input?.closest('.filter'),
          input?.parentElement,
          input?.parentElement?.parentElement,
          input?.parentElement?.parentElement?.parentElement,
          document,
        ].filter(Boolean);

        for (const container of containers) {
          const candidates = Array.from(container.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], .t-button'));
          const matched = candidates.find((element) => {
            if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
            const text = lower(
              element instanceof HTMLInputElement
                ? element.value
                : element.textContent,
            );
            return wanted.some((label) => text === label || text.includes(label));
          });
          if (matched instanceof HTMLElement) return matched;
        }
        return null;
      };
      const getRegionSiteForTarget = () => {
        if (target.startsWith('region-radio:')) return target.slice('region-radio:'.length);
        if (target.startsWith('region-option:')) {
          const title = target.slice('region-option:'.length);
          return regionOptions.find((option) => option.title === title)?.site || '';
        }
        return '';
      };
      const findRegionRadio = () => {
        const site = getRegionSiteForTarget();
        if (!site) return null;
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
      const findRegionTrigger = () => {
        const titles = regionOptions.map((option) => option.title);
        const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([disabled])'));
        const matchedInput = inputs.find((element) => {
          if (!(element instanceof HTMLInputElement) || !isVisible(element)) return false;
          const text = normalizeText(element.value || element.getAttribute('placeholder') || '');
          return titles.includes(text);
        });
        const trigger = matchedInput?.closest('.t-select, .t-input, .t-select__wrap') || matchedInput;
        if (trigger instanceof HTMLElement && isVisible(trigger)) return trigger;
        return null;
      };
      const findRegionOption = () => {
        const title = target.startsWith('region-option:')
          ? target.slice('region-option:'.length)
          : '';
        if (!title) return null;
        const candidates = Array.from(document.querySelectorAll('.t-select-option, li, [role="option"]'));
        return candidates.find((element) => {
          if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
          const text = normalizeText(element.getAttribute('title') || element.textContent || '');
          return text === title;
        }) || null;
      };

      if (target === 'keyword-input') {
        return mark(target, findKeywordInput());
      }

      if (target === 'query-button') {
        return mark(target, findQueryButton());
      }

      if (target === 'region-select-trigger') {
        return mark(target, findRegionTrigger());
      }

      if (target.startsWith('region-radio:')) {
        return mark(target, findRegionRadio());
      }

      if (target.startsWith('region-option:')) {
        return mark(target, findRegionOption());
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
  } catch {
    // retry until timeout
  }
  return '';
}

async function waitForResolvedTargetSelector(page, target, label, timeoutSeconds = TARGET_TIMEOUT_SECONDS) {
  const deadline = Date.now() + (timeoutSeconds * 1000);
  while (Date.now() < deadline) {
    const selector = await tryResolveTargetSelector(page, target);
    if (selector) return selector;
    await page.wait(0.25);
  }

  throw new CommandExecutionError(`shopdora search could not resolve ${label}`);
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

async function setInputValue(page, selector, value) {
  await sleepAction(page);
  const result = await page.evaluate(buildSetInputValueScript(selector, value));
  if (!result || typeof result !== 'object' || result.ok !== true) {
    throw new CommandExecutionError('shopdora search could not set the keyword input value');
  }
  await sleepAction(page);
}

async function clickSelector(page, selector, label) {
  try {
    await sleepAction(page);
    await page.click(selector);
    await sleepAction(page);
  } catch (error) {
    throw new CommandExecutionError(`shopdora search could not click ${label}`, error instanceof Error ? error.message : String(error));
  }
}

async function selectSearchRegion(page, site) {
  const option = getRegionOption(site);
  const radioSelector = await tryResolveTargetSelector(page, `region-radio:${option.site}`);
  if (radioSelector) {
    logStep(`selecting search region via radio: ${option.site}/${option.title}`);
    await clickSelector(page, radioSelector, `${option.title} region radio`);
    return;
  }

  const trigger = await tryResolveTargetSelector(page, 'region-select-trigger');
  if (!trigger && option.site === 'sg') {
    logStep('region selector not found; continuing with Shopdora default region sg');
    return;
  }
  if (!trigger) {
    throw new CommandExecutionError(`shopdora search could not resolve region selector for ${option.site}`);
  }
  await clickSelector(page, trigger, 'region selector');
  const optionSelector = await waitForResolvedTargetSelector(page, `region-option:${option.title}`, `${option.title} region option`);
  await clickSelector(page, optionSelector, `${option.title} region option`);
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
      const guard = '__opencli_shopdora_api_url_interceptor_patched';
      const matches = (url) => {
        try {
          const parsed = new URL(String(url || ''), window.location.href);
          return parsed.origin === 'https://www.shopdora.com' && parsed.pathname.startsWith('/api/');
        } catch {
          return false;
        }
      };
      const pushCapture = (url, text) => {
        const entry = { url: String(url || ''), body: String(text || '') };
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
        const response = await originalFetch.apply(this, args);
        if (matches(requestUrl)) {
          try {
            const text = await response.clone().text();
            pushCapture(requestUrl, text);
          } catch {}
        }
        return response;
      };

      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url) {
        try {
          Object.defineProperty(this, '__opencliShopdoraApiUrl', {
            value: String(url || ''),
            writable: true,
            enumerable: false,
            configurable: true,
          });
        } catch {
          this.__opencliShopdoraApiUrl = String(url || '');
        }
        return originalOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function() {
        if (matches(this.__opencliShopdoraApiUrl)) {
          this.addEventListener('load', function() {
            try {
              pushCapture(this.__opencliShopdoraApiUrl, this.responseText);
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

function isShopdoraProductSearchUrl(value) {
  try {
    const url = new URL(String(value ?? ''), 'https://www.shopdora.com');
    return url.origin === 'https://www.shopdora.com' && url.pathname === '/api/product/search';
  } catch {
    return false;
  }
}

function isProductSearchEntry(entry) {
  const url = String(entry?.url ?? entry?.request?.url ?? entry?.response?.url ?? '');
  if (!url) return false;
  return isShopdoraProductSearchUrl(url);
}

function isSuccessfulSearchPayload(payload) {
  return Boolean(
    payload
      && typeof payload === 'object'
      && payload.code === 'ok'
      && payload.data
      && typeof payload.data === 'object',
  );
}

function extractLatestProductSearchPayload(entries) {
  if (!Array.isArray(entries)) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isProductSearchEntry(entry)) continue;
    const payload = parseInterceptedPayload(entry);
    if (isSuccessfulSearchPayload(payload)) return payload;
  }
  return null;
}

function summarizeCapturedApiUrls(entries, limit = 12) {
  if (!Array.isArray(entries) || entries.length === 0) return '(none)';
  const urls = entries
    .map((entry) => String(entry?.url ?? entry?.request?.url ?? entry?.response?.url ?? ''))
    .filter(Boolean)
    .slice(-limit);
  return urls.length > 0 ? urls.join(', ') : '(no_urls)';
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
    const payload = extractLatestProductSearchPayload(entries);
    if (payload) return { payload, entries };
    await sleep(page, 0.5);
  }
  return { payload: null, entries: lastEntries };
}

function extractSearchResult(payload) {
  if (Array.isArray(payload?.data?.list)) return payload.data.list;
  if (payload?.data && typeof payload.data === 'object') return payload.data;
  return [];
}

function mapSearchResultWithUrls(result, site) {
  if (Array.isArray(result)) {
    return result.map((item) => ({
      ...item,
      url: buildShopeeProductUrl(item, site),
    }));
  }
  if (result && typeof result === 'object' && Array.isArray(result.list)) {
    return {
      ...result,
      list: result.list.map((item) => ({
        ...item,
        url: buildShopeeProductUrl(item, site),
      })),
    };
  }
  return result;
}

cli({
  site: 'shopdora',
  name: 'search',
  access: 'read',
  description: 'Search Shopdora hot products by keyword',
  domain: 'www.shopdora.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    {
      name: 'keyword',
      positional: true,
      required: true,
      help: 'Shopdora hot product search keyword',
    },
    {
      name: 'region',
      type: 'str',
      default: 'sg',
      help: 'Shopee region/site, e.g. sg,my,tw,ph,th,vn,br,id,mx,mc',
    },
  ],
  columns: OUTPUT_COLUMNS,
  func: async (page, args) => {
    if (!page) {
      throw new CommandExecutionError(
        'Browser session required for shopdora search',
        'Run the command with the browser bridge connected',
      );
    }

    const keyword = normalizeKeyword(args.keyword);
    const region = normalizeRegion(args.region);
    await openShopdoraPage(page, SHOPDORA_HOT_PRODUCT_URL);
    const loginState = await readShopdoraLoginState(page);
    if (loginState.hasShopdoraLoginPage || loginState.hasPageDetailLoginTitle) {
      throw new AuthRequiredError('www.shopdora.com', `${SHOPDORA_NOT_LOGGED_IN_MESSAGE}，请先登录 Shopdora 后重试。`);
    }

    const inputSelector = await waitForResolvedTargetSelector(page, 'keyword-input', 'keyword input');
    const buttonSelector = await waitForResolvedTargetSelector(page, 'query-button', 'query button');

    await page.installInterceptor(PRODUCT_SEARCH_API_PATTERN);
    await installShopdoraApiUrlInterceptor(page);
    await selectSearchRegion(page, region);
    await setInputValue(page, inputSelector, keyword);
    await clickSelector(page, buttonSelector, 'query button');
    if (typeof page.waitForCapture === 'function') {
      await page.waitForCapture(SEARCH_CAPTURE_TIMEOUT_SECONDS);
    }

    const capture = await waitForProductSearchPayload(page, SEARCH_CAPTURE_TIMEOUT_SECONDS);
    const payload = capture.payload;
    if (!payload) {
      throw new CommandExecutionError(
        'shopdora search did not capture a valid /api/product/search response',
        `Captured API URLs: ${summarizeCapturedApiUrls(capture.entries)}. Check that Shopdora is logged in and the hot-product search request still fires from the page.`,
      );
    }

    return mapSearchResultWithUrls(extractSearchResult(payload), region);
  },
});

export const __test__ = {
  SHOPDORA_HOT_PRODUCT_URL,
  PRODUCT_SEARCH_API_PATTERN,
  OUTPUT_COLUMNS,
  RESOLVED_TARGET_ATTRIBUTE,
  SEARCH_KEYWORD_PLACEHOLDERS,
  SEARCH_BUTTON_TEXTS,
  REGION_OPTIONS,
  normalizeKeyword,
  normalizeRegion,
  getRegionOption,
  buildShopeeProductUrl,
  buildResolveTargetSelectorScript,
  buildSetInputValueScript,
  buildInstallShopdoraApiUrlInterceptorScript,
  parseInterceptedPayload,
  isProductSearchEntry,
  isShopdoraProductSearchUrl,
  isSuccessfulSearchPayload,
  extractLatestProductSearchPayload,
  summarizeCapturedApiUrls,
  readAllCapturedEntries,
  waitForProductSearchPayload,
  extractSearchResult,
  mapSearchResultWithUrls,
  installShopdoraApiUrlInterceptor,
  readCapturedShopdoraEntries,
  waitForResolvedTargetSelector,
  setInputValue,
  selectSearchRegion,
  runWithFocusedWindow,
  openShopdoraPage,
};
