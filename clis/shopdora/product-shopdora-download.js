import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from '@jackwener/opencli/errors';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { log } from '@jackwener/opencli/logger';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { readShopdoraLoginState, SHOPDORA_NOT_LOGGED_IN_MESSAGE } from '../shopee/shared.js';

const SHOPDORA_COMMENT_ANALYSIS_URL = 'https://www.shopdora.com/my/analysis/comment';
const SHOPDORA_API_CAPTURE_PATTERN = '/api/';
const SHOPDORA_COMMENT_DETAIL_URL = 'https://www.shopdora.com/my/analysis/newComment';
const SHOPDORA_COMMENT_LIST_API_URL = 'https://www.shopdora.com/api/comment/list';
const SHOPDORA_COMMENT_EXPORT_API_URL = 'https://www.shopdora.com/api/comment/export';
const SHOPDORA_INSUFFICIENT_COMMENT_SUMMARY_MESSAGE = '该产品累计评论数少于50条，无法对其进行评论总结，请选择其他产品进行分析';
const RESOLVED_TARGET_ATTRIBUTE = 'data-opencli-shopdora-product-shopdora-download-target';
const ADD_BUTTON_TEXTS = ['添加产品', '添加添加', '添加', 'Add Products', 'Add Product', 'Add'];
const PRODUCT_LINK_LABEL_TEXTS = ['产品链接', 'Product Link', 'Product URL'];
const QUERY_BUTTON_TEXTS = ['查询', 'Query', 'Search'];
const COMMENT_ANALYSIS_KEYWORD_PLACEHOLDERS = ['产品名/id/关键字', '产品名 / id / 关键字', 'Product Name/ID/Keyword'];
const SUBMIT_BUTTON_TEXTS = ['提交', 'Submit'];
const CONFIRM_BUTTON_TEXTS = ['确定', '确认', 'OK'];
const COMMENT_DETAIL_TAB_TEXTS = ['评论详情'];
const DOWNLOAD_COMMENT_BUTTON_TEXTS = ['下载评论', 'Download Comment'];
const COMMENT_TIME_LABEL_TEXTS = ['评论时间', 'Comment Time', 'Comment Date'];
const DETAIL_RATING_LABEL_TEXTS = {
  'rating-4-input': ['4星'],
  'rating-3-input': ['3星'],
  'rating-2-input': ['2星'],
  'rating-1-input': ['1星'],
  'media-checkbox-input': ['图片/视频'],
  'empty-comment-checkbox-input': ['过滤空评论'],
};
const DETAIL_RATING_VALUES = {
  'rating-4-input': '4',
  'rating-3-input': '3',
  'rating-2-input': '2',
  'rating-1-input': '1',
};
const DETAIL_COMMENT_TYPE_VALUES = {
  'media-checkbox-input': '1',
  'empty-comment-checkbox-input': '2',
};
const TARGET_TIMEOUT_SECONDS = 15;
const RESULT_TIMEOUT_SECONDS = 600;
const EXISTING_TASK_DISCOVERY_SECONDS = 8;
const DOWNLOAD_TIMEOUT_SECONDS = 1800;
const COMMENT_LIST_CAPTURE_TIMEOUT_SECONDS = 30;
const TASK_PROGRESS_REFRESH_INTERVAL_SECONDS = 120;
const COMMENT_TIME_MONTH_OFFSET = -3;
const NAVIGATION_TIMEOUT_MS = 15000;
const ACTION_WAIT_MIN_SECONDS = 0.5;
const ACTION_WAIT_MAX_SECONDS = 1;
const LOG_PREFIX = '[shopdora product-shopdora-download]';
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

const OUTPUT_COLUMNS = [];

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
    throw new ArgumentError('shopdora product-shopdora-download requires a valid absolute Shopee product URL.');
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new ArgumentError('shopdora product-shopdora-download only supports http(s) Shopee product URLs.');
  }

  if (!/shopee\./i.test(parsed.hostname)) {
    throw new ArgumentError('shopdora product-shopdora-download only supports Shopee product URLs.');
  }

  return parsed.toString();
}

function parseShopeeProductIdentifiers(shopeeProductUrl) {
  const raw = normalizeText(shopeeProductUrl);
  try {
    const { pathname } = new URL(raw);
    const pathMatch = pathname.match(/\/product\/(\d+)\/(\d+)(?:\/|$)/i);
    if (pathMatch) {
      return {
        shopId: pathMatch[1] ?? '',
        itemId: pathMatch[2] ?? '',
      };
    }
  } catch {
    // fall through to legacy URL patterns
  }

  const match = raw.match(/(?:^|[./-])i\.(\d+)\.(\d+)(?:[/?#]|$)/i) || raw.match(/-i\.(\d+)\.(\d+)(?:[/?#]|$)/i);
  if (!match) {
    return { shopId: '', itemId: '' };
  }

  return {
    shopId: match[1] ?? '',
    itemId: match[2] ?? '',
  };
}

function deriveShopeeSiteFromUrl(shopeeProductUrl) {
  const region = getShopeeRegionOptionFromUrl(shopeeProductUrl);
  if (region?.site) return region.site;
  return '';
}

function getShopeeRegionOptionFromUrl(shopeeProductUrl) {
  try {
    const { hostname } = new URL(shopeeProductUrl);
    const normalized = hostname.toLowerCase();
    return SHOPEE_REGION_OPTIONS.find((option) => (
      option.domains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`))
    )) || null;
  } catch {
    // best-effort fallback
  }
  return null;
}

function buildCommentDetailUrl(task) {
  const url = new URL(SHOPDORA_COMMENT_DETAIL_URL);
  url.searchParams.set('site', String(task?.site ?? ''));
  url.searchParams.set('taskKey', String(task?.taskKey ?? ''));
  url.searchParams.set('shopId', String(task?.shopId ?? ''));
  return url.toString();
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

function buildInstallShopdoraApiUrlInterceptorScript() {
  return `
    (() => {
      const arrayName = '__opencli_xhr';
      const guard = '__opencli_shopdora_api_url_interceptor_patched';
      const matches = (url) => {
        try {
          const parsed = new URL(String(url || ''), window.location.href);
          return parsed.origin === 'https://www.shopdora.com' && parsed.pathname.startsWith('/api/');
        } catch {
          return false;
        }
      };
      const normalizeHeaders = (headers) => {
        const result = {};
        try {
          if (!headers) return result;
          if (headers instanceof Headers) {
            headers.forEach((value, key) => {
              result[String(key).toLowerCase()] = String(value);
            });
            return result;
          }
          if (Array.isArray(headers)) {
            headers.forEach(([key, value]) => {
              result[String(key).toLowerCase()] = String(value);
            });
            return result;
          }
          Object.entries(headers).forEach(([key, value]) => {
            result[String(key).toLowerCase()] = String(value);
          });
        } catch {}
        return result;
      };
      const pushCapture = (url, text, requestBody, requestHeaders) => {
        const entry = {
          url: String(url || ''),
          body: String(text || ''),
          requestBody: typeof requestBody === 'string' ? requestBody : '',
          requestHeaders: normalizeHeaders(requestHeaders),
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
        const init = args[1] || {};
        const requestBody = typeof init.body === 'string' ? init.body : '';
        const requestHeaders = normalizeHeaders(init.headers || (args[0] && args[0].headers));
        const response = await originalFetch.apply(this, args);
        if (matches(requestUrl)) {
          try {
            const text = await response.clone().text();
            pushCapture(requestUrl, text, requestBody, requestHeaders);
          } catch {}
        }
        return response;
      };

      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
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
        this.__opencliShopdoraApiHeaders = {};
        return originalOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        try {
          this.__opencliShopdoraApiHeaders = this.__opencliShopdoraApiHeaders || {};
          this.__opencliShopdoraApiHeaders[String(name).toLowerCase()] = String(value);
        } catch {}
        return originalSetRequestHeader.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function(body) {
        if (matches(this.__opencliShopdoraApiUrl)) {
          this.addEventListener('load', function() {
            try {
              pushCapture(
                this.__opencliShopdoraApiUrl,
                this.responseText,
                typeof body === 'string' ? body : '',
                this.__opencliShopdoraApiHeaders || {},
              );
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
  const result = await page.evaluate(buildInstallShopdoraApiUrlInterceptorScript());
  if (result && typeof result === 'object' && result.ok) {
    logStep(`shopdora API URL interceptor ready: alreadyInstalled=${Boolean(result.alreadyInstalled)}`);
  }
}

function normalizeUrlPathname(value) {
  return String(value ?? '').replace(/\/+$/, '') || '/';
}

function isExpectedShopdoraUrl(currentUrl, targetUrl) {
  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);
    if (current.origin !== target.origin) return false;
    if (normalizeUrlPathname(current.pathname) !== normalizeUrlPathname(target.pathname)) return false;
    for (const [key, value] of target.searchParams.entries()) {
      if (current.searchParams.get(key) !== value) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function readCurrentPageUrl(page, fallback = '') {
  if (typeof page?.getCurrentUrl === 'function') {
    try {
      const value = await page.getCurrentUrl();
      if (typeof value === 'string' && value.trim()) return value.trim();
    } catch {
      // fall through
    }
  }

  if (typeof page?.evaluate === 'function') {
    try {
      const value = await page.evaluate('window.location.href');
      if (typeof value === 'string' && value.trim()) return value.trim();
    } catch {
      // fall through
    }
  }

  return fallback;
}

async function waitForExpectedShopdoraUrl(page, targetUrl, timeoutMs = NAVIGATION_TIMEOUT_MS) {
  const canReadUrl = typeof page?.getCurrentUrl === 'function' || typeof page?.evaluate === 'function';
  if (!canReadUrl) return targetUrl;

  const deadline = Date.now() + timeoutMs;
  let lastUrl = '';
  while (Date.now() < deadline) {
    lastUrl = await readCurrentPageUrl(page, lastUrl || targetUrl);
    if (isExpectedShopdoraUrl(lastUrl, targetUrl)) {
      return { ok: true, currentUrl: lastUrl };
    }
    await sleep(page, 0.25);
  }

  return {
    ok: isExpectedShopdoraUrl(lastUrl, targetUrl),
    currentUrl: lastUrl || targetUrl,
  };
}

function buildResolveTargetSelectorScript(target) {
  return `
    (() => {
      const target = ${JSON.stringify(target)};
      const attr = ${JSON.stringify(RESOLVED_TARGET_ATTRIBUTE)};
      const addTexts = ${JSON.stringify(ADD_BUTTON_TEXTS)};
      const productLinkLabelTexts = ${JSON.stringify(PRODUCT_LINK_LABEL_TEXTS)};
      const queryTexts = ${JSON.stringify(QUERY_BUTTON_TEXTS)};
      const commentAnalysisKeywordPlaceholders = ${JSON.stringify(COMMENT_ANALYSIS_KEYWORD_PLACEHOLDERS)};
      const submitTexts = ${JSON.stringify(SUBMIT_BUTTON_TEXTS)};
      const confirmTexts = ${JSON.stringify(CONFIRM_BUTTON_TEXTS)};
      const detailTabTexts = ${JSON.stringify(COMMENT_DETAIL_TAB_TEXTS)};
      const downloadCommentTexts = ${JSON.stringify(DOWNLOAD_COMMENT_BUTTON_TEXTS)};
      const commentTimeLabelTexts = ${JSON.stringify(COMMENT_TIME_LABEL_TEXTS)};
      const checkboxTexts = ${JSON.stringify(DETAIL_RATING_LABEL_TEXTS)};
      const ratingValues = ${JSON.stringify(DETAIL_RATING_VALUES)};
      const commentTypeValues = ${JSON.stringify(DETAIL_COMMENT_TYPE_VALUES)};
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
      const visibleDialogs = () => Array.from(document.querySelectorAll(
        '.t-dialog, .t-dialog__wrap, .el-dialog, .ant-modal, [role="dialog"]'
      )).filter((element) => element instanceof HTMLElement && isVisible(element));
      const latestVisibleDialog = () => {
        const dialogs = visibleDialogs();
        return dialogs.length > 0 ? dialogs[dialogs.length - 1] : null;
      };
      const textMatches = (text, texts) => texts.some((label) => text === label || text.includes(label));
      const findButtonByText = (scope, texts) => {
        const wanted = texts.map(lower);
        const candidates = Array.from((scope || document).querySelectorAll(
          'button, [role="button"], input[type="button"], input[type="submit"], .t-button'
        ));
        return candidates.find((element) => {
          if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
          const text = lower(
            element instanceof HTMLInputElement
              ? element.value
              : element.textContent,
          );
          return textMatches(text, wanted);
        }) || null;
      };
      const findTabByText = (scope, texts) => {
        const wanted = texts.map(lower);
        const exactTabText = Array.from((scope || document).querySelectorAll(
          '.t-tabs__nav-item, .t-tabs__nav-item-wrapper, .t-tabs__nav-item-text-wrapper'
        ));
        for (const element of exactTabText) {
          if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
          const text = lower(element.textContent);
          if (!text || !textMatches(text, wanted)) continue;
          const item = element.closest('.t-tabs__nav-item');
          if (item instanceof HTMLElement && isVisible(item)) return item;
          if (element instanceof HTMLElement) return element;
        }

        const selectors = [
          '[role="tab"]',
          'a',
          'button',
          'li',
          'div',
          'span',
          '.t-tabs__nav-item',
          '.t-tabs__item',
          '.el-tabs__item',
          '.ant-tabs-tab',
          '.tab',
          '.tabs-item',
        ].join(', ');
        const candidates = Array.from((scope || document).querySelectorAll(selectors));
        return candidates.find((element) => {
          if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
          const text = lower(element.textContent);
          if (!text || !textMatches(text, wanted)) return false;
          const role = lower(element.getAttribute('role'));
          const className = lower(element.className);
          return role === 'tab'
            || className.includes('tab')
            || className.includes('tabs')
            || className.includes('nav')
            || textMatches(text, wanted);
        }) || null;
      };
      const findClickableByText = (scope, texts) => {
        const wanted = texts.map(lower);
        const selectors = [
          'button',
          '[role="button"]',
          'a',
          'span',
          'div',
          '.t-button',
          '.t-button__text',
          '.el-button',
          '.ant-btn',
        ].join(', ');
        const candidates = Array.from((scope || document).querySelectorAll(selectors));
        for (const element of candidates) {
          if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
          const text = lower(
            element instanceof HTMLInputElement
              ? element.value
              : element.textContent,
          );
          if (!text || !textMatches(text, wanted)) continue;

          const clickable = element.closest('button, [role="button"], a, .t-button, .el-button, .ant-btn');
          if (clickable instanceof HTMLElement && isVisible(clickable)) return clickable;
          return element;
        }
        return null;
      };
      const findDownloadCommentButton = () => {
        const direct = document.querySelector('.item-btn button.t-button, .item-btn .t-button');
        if (direct instanceof HTMLElement && isVisible(direct)) {
          const text = lower(direct.textContent);
          if (textMatches(text, downloadCommentTexts.map(lower))) return direct;
        }

        const textNode = document.querySelector('.item-btn .t-button__text');
        if (textNode instanceof HTMLElement && isVisible(textNode)) {
          const text = lower(textNode.textContent);
          if (textMatches(text, downloadCommentTexts.map(lower))) {
            const button = textNode.closest('button, .t-button');
            if (button instanceof HTMLElement && isVisible(button)) return button;
            return textNode;
          }
        }

        return findClickableByText(document, downloadCommentTexts);
      };
      const findAddButton = () => {
        const exactSelectors = [
          '.inline-filter-containter button.add',
          '.inline-filter-containter .t-button.add',
          'form button.add',
          'form .t-button.add',
          'button.add',
          '.t-button.add',
        ];
        for (const selector of exactSelectors) {
          const element = document.querySelector(selector);
          if (element instanceof HTMLElement && isVisible(element)) return element;
        }

        const addIcon = document.querySelector('.t-icon-add');
        const iconButton = addIcon?.closest('button, [role="button"], .t-button');
        if (iconButton instanceof HTMLElement && isVisible(iconButton)) return iconButton;

        return findButtonByText(document, addTexts);
      };
      const findInputByLabel = (scope, labelTexts) => {
        const wanted = labelTexts.map(lower);
        const labelCandidates = Array.from((scope || document).querySelectorAll(
          'label, .t-form__label, .el-form-item__label, .ant-form-item-label label, .form-label, .label, span, div'
        ));
        for (const element of labelCandidates) {
          if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
          const text = lower(element.textContent);
          if (!text || !wanted.some((label) => text === label || text.includes(label))) continue;
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

        const fallback = Array.from((scope || document).querySelectorAll('input:not([type="hidden"]):not([disabled]), textarea:not([disabled])'))
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
        return fallback instanceof HTMLElement ? fallback : null;
      };
      const findCommentAnalysisKeywordInput = () => {
        const exactPlaceholder = Array.from(document.querySelectorAll('input.t-input__inner, input'))
          .find((element) => {
            if (!(element instanceof HTMLInputElement) || !isVisible(element)) return false;
            const placeholder = normalizeText(element.getAttribute('placeholder') || '');
            return commentAnalysisKeywordPlaceholders.some((label) => placeholder === label);
          });
        if (exactPlaceholder instanceof HTMLElement) return exactPlaceholder;

        const fuzzyPlaceholder = Array.from(document.querySelectorAll('input.t-input__inner, input'))
          .find((element) => {
            if (!(element instanceof HTMLInputElement) || !isVisible(element)) return false;
            const placeholder = normalizeText(element.getAttribute('placeholder') || '');
            return commentAnalysisKeywordPlaceholders.some((label) => placeholder.includes(label) || label.includes(placeholder));
          });
        return fuzzyPlaceholder instanceof HTMLElement ? fuzzyPlaceholder : null;
      };
      const findRegionSelectTrigger = () => {
        const titles = regionOptions.map((option) => option.title).concat(['全部']);
        const inputs = Array.from(document.querySelectorAll('input.t-input__inner, input'));
        for (const input of inputs) {
          if (!(input instanceof HTMLInputElement) || !isVisible(input)) continue;
          const placeholder = normalizeText(input.getAttribute('placeholder') || '');
          const value = normalizeText(input.value || '');
          if (!titles.includes(placeholder) && !titles.includes(value)) continue;

          const trigger = input.closest('.t-select, .t-input, .t-select__wrap, .t-input__wrap')
            || input.parentElement;
          if (trigger instanceof HTMLElement && isVisible(trigger)) return trigger;
          return input;
        }

        return null;
      };
      const findRegionOption = (title) => {
        const wanted = normalizeText(title);
        if (!wanted) return null;
        const optionSelectors = [
          '.t-select__list .t-select-option',
          '.t-select-option',
          '.t-select-option__content',
          '.t-popup .t-select-option',
          '.t-popup li',
          '.t-popup [role="option"]',
          '.t-popup [title]',
          '.t-popup__content li',
          '.t-popup__content [role="option"]',
          '.el-select-dropdown__item',
          '.ant-select-item-option',
          'li[title]',
          '[role="option"]',
        ].join(', ');
        const options = Array.from(document.querySelectorAll(optionSelectors));
        for (const option of options) {
          if (!(option instanceof HTMLElement) || !isVisible(option)) continue;
          const optionTitle = normalizeText(option.getAttribute('title') || '');
          const optionText = normalizeText(option.textContent || '');
          if (optionTitle === wanted || optionText === wanted || optionText.includes(wanted)) {
            const clickable = option.closest('.t-select-option, [role="option"], li, .el-select-dropdown__item, .ant-select-item-option');
            if (clickable instanceof HTMLElement && isVisible(clickable)) return clickable;
            return option;
          }
        }
        return null;
      };
      const findCheckboxTargetByLabel = (texts) => {
        const wanted = texts.map(lower);
        const labels = Array.from(document.querySelectorAll('label, .t-checkbox, .el-checkbox, .ant-checkbox-wrapper'));
        for (const label of labels) {
          if (!(label instanceof HTMLElement) || !isVisible(label)) continue;
          const text = lower(label.textContent);
          if (!text || !textMatches(text, wanted)) continue;
          const input = label.querySelector('input[type="checkbox"]');
          if (input instanceof HTMLElement) return input;
          return label;
        }

        const wrappers = Array.from(document.querySelectorAll('input[type="checkbox"], [role="checkbox"], [role="radio"]'));
        for (const input of wrappers) {
          if (!(input instanceof HTMLElement)) continue;
          const joined = lower([
            input.getAttribute('aria-label'),
            input.getAttribute('name'),
            input.getAttribute('id'),
            input.parentElement?.textContent,
            input.closest('label')?.textContent,
          ].filter(Boolean).join(' '));
          if (textMatches(joined, wanted)) return input;
        }

        const textCandidates = Array.from(document.querySelectorAll(
          'span, div, li, button, a, p, strong, em, [role="button"], [role="checkbox"], [role="radio"]'
        ));
        for (const element of textCandidates) {
          if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
          const text = lower(element.textContent);
          if (!text || !textMatches(text, wanted)) continue;

          const localClickable = element.querySelector('input[type="checkbox"], [role="checkbox"], [role="radio"], button');
          if (localClickable instanceof HTMLElement) return localClickable;

          const containers = [
            element.closest('label'),
            element.closest('[role="checkbox"]'),
            element.closest('[role="radio"]'),
            element.closest('button'),
            element.closest('.t-checkbox'),
            element.closest('.el-checkbox'),
            element.closest('.ant-checkbox-wrapper'),
            element.parentElement,
            element.parentElement?.parentElement,
            element.parentElement?.parentElement?.parentElement,
          ].filter(Boolean);

          for (const container of containers) {
            const nestedClickable = container?.querySelector('input[type="checkbox"], [role="checkbox"], [role="radio"], button');
            if (nestedClickable instanceof HTMLElement) return nestedClickable;
            if (container instanceof HTMLElement && isVisible(container)) return container;
          }
        }

        return null;
      };
      const findRatingCheckboxByValue = (targetName) => {
        const ratingValue = ratingValues[targetName];
        if (!ratingValue) return null;

        const ratingSections = Array.from(document.querySelectorAll('.item-data, .item-list, .t-checkbox-group'));
        for (const section of ratingSections) {
          if (!(section instanceof HTMLElement)) continue;
          const text = lower(section.textContent);
          if (!text.includes('星级')) continue;

          const direct = section.querySelector('input.t-checkbox__former[type="checkbox"][value="' + ratingValue + '"]');
          if (direct instanceof HTMLElement) return direct;
        }

        const globalFallback = document.querySelector(
          'input.t-checkbox__former[type="checkbox"][value="' + ratingValue + '"]'
        );
        return globalFallback instanceof HTMLElement ? globalFallback : null;
      };
      const findCommentTypeCheckboxByValue = (targetName) => {
        const filterValue = commentTypeValues[targetName];
        if (!filterValue) return null;

        const typeSections = Array.from(document.querySelectorAll('.item-data, .item-list, .t-checkbox-group'));
        for (const section of typeSections) {
          if (!(section instanceof HTMLElement)) continue;
          const text = lower(section.textContent);
          if (!text.includes('评论类型')) continue;

          const direct = section.querySelector('input.t-checkbox__former[type="checkbox"][value="' + filterValue + '"]');
          if (direct instanceof HTMLElement) return direct;
        }

        const globalFallback = document.querySelector(
          'input.t-checkbox__former[type="checkbox"][value="' + filterValue + '"]'
        );
        return globalFallback instanceof HTMLElement ? globalFallback : null;
      };
      const findLeftDateInput = () => {
        const wanted = commentTimeLabelTexts.map(lower);
        const titleCandidates = Array.from(document.querySelectorAll('.item-title, .reviewTitle, label, span, div'));
        for (const title of titleCandidates) {
          if (!(title instanceof HTMLElement) || !isVisible(title)) continue;
          const text = lower(title.textContent);
          if (!text || !textMatches(text, wanted)) continue;

          const section = title.closest('.item-data')
            || title.parentElement
            || title.parentElement?.parentElement
            || null;
          const exactInput = section?.querySelector('.item-list .t-range-input__inner-left input.t-input__inner, .t-range-input__inner-left input.t-input__inner');
          if (exactInput instanceof HTMLElement) return exactInput;

          const anyLeftInput = section?.querySelector('.item-list input.t-input__inner, .item-list input, .t-date-range-picker input, .t-range-input input');
          if (anyLeftInput instanceof HTMLElement) return anyLeftInput;
        }

        const rangeRoots = Array.from(document.querySelectorAll('.t-range-input, .el-range-editor, .ant-picker-range, .t-date-range-picker'));
        for (const root of rangeRoots) {
          if (!(root instanceof HTMLElement) || !isVisible(root)) continue;
          const input = root.querySelector('.t-range-input__inner-left input.t-input__inner, .t-range-input__inner-left input, input');
          if (input instanceof HTMLElement && isVisible(input)) return input;
        }

        const inputs = Array.from(document.querySelectorAll('input'))
          .filter((element) => element instanceof HTMLElement && isVisible(element));
        return inputs.find((input) => {
          const joined = lower([
            input.getAttribute('placeholder'),
            input.getAttribute('aria-label'),
            input.getAttribute('name'),
            input.getAttribute('id'),
          ].filter(Boolean).join(' '));
          return joined.includes('时间') || joined.includes('date') || joined.includes('time');
        }) || null;
      };
      if (target === 'add-button') {
        return mark(target, findAddButton());
      }

      if (target === 'product-link-input') {
        return mark(target, findInputByLabel(latestVisibleDialog() || document, productLinkLabelTexts));
      }

      if (target === 'comment-analysis-keyword-input') {
        return mark(target, findCommentAnalysisKeywordInput());
      }

      if (target === 'query-button') {
        return mark(target, findButtonByText(document, queryTexts));
      }

      if (target === 'region-select-trigger') {
        return mark(target, findRegionSelectTrigger());
      }

      if (target.startsWith('region-option:')) {
        return mark(target, findRegionOption(target.slice('region-option:'.length)));
      }

      if (target === 'submit-button') {
        return mark(target, findButtonByText(latestVisibleDialog() || document, submitTexts));
      }

      if (target === 'confirm-button') {
        return mark(target, findButtonByText(latestVisibleDialog() || document, confirmTexts));
      }

      if (target === 'comment-detail-tab') {
        return mark(target, findTabByText(document, detailTabTexts));
      }

      if (target === 'comment-time-start-input') {
        return mark(target, findLeftDateInput());
      }

      if (target === 'download-comment-button') {
        return mark(target, findDownloadCommentButton());
      }

      if (target in checkboxTexts) {
        if (target in ratingValues) {
          const exactRating = findRatingCheckboxByValue(target);
          if (exactRating) {
            return mark(target, exactRating);
          }
        }
        if (target in commentTypeValues) {
          const exactCommentType = findCommentTypeCheckboxByValue(target);
          if (exactCommentType) {
            return mark(target, exactCommentType);
          }
        }
        return mark(target, findCheckboxTargetByLabel(checkboxTexts[target]));
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
    // best-effort probe
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
  throw new CommandExecutionError(`shopdora product-shopdora-download could not resolve ${label}`);
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

function buildEnsureCheckboxStateScript(selector, checked) {
  return `
    (() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!(target instanceof HTMLElement)) {
        return { ok: false, error: 'toggle_target_not_found' };
      }

      const input =
        target instanceof HTMLInputElement && target.type === 'checkbox'
          ? target
          : target.querySelector?.('input[type="checkbox"]') instanceof HTMLInputElement
            ? target.querySelector('input[type="checkbox"]')
            : null;
      const resolveState = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element instanceof HTMLInputElement && element.type === 'checkbox') return element.checked;
        const ariaChecked = String(element.getAttribute('aria-checked') || '').toLowerCase();
        const ariaSelected = String(element.getAttribute('aria-selected') || '').toLowerCase();
        const className = String(element.className || '').toLowerCase();
        return ariaChecked === 'true'
          || ariaSelected === 'true'
          || className.includes('checked')
          || className.includes('selected')
          || className.includes('active')
          || className.includes('is-checked')
          || className.includes('is-selected')
          || className.includes('is-active');
      };

      const beforeChecked = input instanceof HTMLInputElement
        ? input.checked
        : resolveState(target);

      if (beforeChecked === ${checked ? 'true' : 'false'}) {
        return { ok: true, changed: false, checked: beforeChecked };
      }

      const label = input?.closest('label');
      const clickable = label || target;
      if (!(clickable instanceof HTMLElement)) {
        return { ok: false, error: 'toggle_click_target_not_found' };
      }

      clickable.click();
      const afterChecked = input instanceof HTMLInputElement
        ? input.checked
        : resolveState(target);
      return { ok: afterChecked === ${checked ? 'true' : 'false'}, changed: true, checked: afterChecked };
    })()
  `;
}

function buildReadInputValueScript(selector) {
  return `
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) {
        return { ok: false, error: 'date_input_not_found' };
      }
      return { ok: true, value: input.value };
    })()
  `;
}

function buildReadRegionSelectValueScript(selector) {
  return `
    (() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!(target instanceof HTMLElement)) {
        return { ok: false, error: 'region_select_not_found' };
      }
      const input = target instanceof HTMLInputElement
        ? target
        : target.querySelector('input.t-input__inner, input');
      const value = input instanceof HTMLInputElement
        ? (input.value || input.getAttribute('placeholder') || '')
        : (target.textContent || '');
      return { ok: true, value: String(value || '').replace(/\\s+/g, ' ').trim() };
    })()
  `;
}

function buildReadRangeInputValuesScript(selector) {
  return `
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) {
        return { ok: false, error: 'date_input_not_found' };
      }

      const rangeRoot = input.closest('.t-range-input, .t-date-range-picker, .item-list, .item-data') || input.parentElement;
      const leftInput = rangeRoot?.querySelector?.('.t-range-input__inner-left input.t-input__inner, .t-range-input__inner-left input') || input;
      const rightInput = rangeRoot?.querySelector?.('.t-range-input__inner-right input.t-input__inner, .t-range-input__inner-right input') || null;

      return {
        ok: true,
        startValue: leftInput instanceof HTMLInputElement ? leftInput.value : input.value,
        endValue: rightInput instanceof HTMLInputElement ? rightInput.value : '',
      };
    })()
  `;
}

function buildDispatchEnterOnInputScript(selector) {
  return `
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) {
        return { ok: false, error: 'date_input_not_found' };
      }
      input.focus();
      const eventInit = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      };
      input.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      input.dispatchEvent(new KeyboardEvent('keypress', eventInit));
      input.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    })()
  `;
}

async function setInputValue(page, selector, value) {
  const result = await page.evaluate(buildSetInputValueScript(selector, value));
  if (!result || typeof result !== 'object' || result.ok !== true) {
    throw new CommandExecutionError('shopdora product-shopdora-download could not set the product-link input value');
  }
  await sleepAction(page);
}

async function ensureCheckboxState(page, selector, checked, label) {
  const result = await page.evaluate(buildEnsureCheckboxStateScript(selector, checked));
  if (!result || typeof result !== 'object' || !result.ok) {
    throw new CommandExecutionError(`shopdora product-shopdora-download could not ${checked ? 'enable' : 'disable'} ${label}`);
  }
  await sleepAction(page);
}

async function clickSelector(page, selector, label) {
  try {
    await sleepAction(page);
    await page.click(selector);
    await sleepAction(page);
    return;
  } catch (error) {
    let fallbackMessage = '';
    if (typeof page?.evaluate === 'function') {
      try {
        const result = await page.evaluate(buildForceDomClickScript(selector));
        if (result && typeof result === 'object' && result.ok === true) {
          logStep(`clicked ${label} with DOM fallback`);
          await sleepAction(page);
          return;
        }
        fallbackMessage = result && typeof result === 'object' && result.error
          ? `; DOM fallback failed: ${result.error}`
          : '; DOM fallback failed';
      } catch (fallbackError) {
        fallbackMessage = `; DOM fallback failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`;
      }
    }

    throw new CommandExecutionError(
      `shopdora product-shopdora-download could not click ${label}`,
      `${error instanceof Error ? error.message : String(error)}${fallbackMessage}`,
    );
  }
}

async function selectCommentAnalysisRegion(page, regionTitle) {
  const title = normalizeText(regionTitle);
  if (!title) return false;

  logStep(`selecting comment analysis region: ${title}`);
  const regionSelectSelector = await waitForResolvedTargetSelector(
    page,
    'region-select-trigger',
    'region select',
  );
  const current = await page.evaluate(buildReadRegionSelectValueScript(regionSelectSelector));
  if (current && typeof current === 'object' && current.ok && normalizeText(current.value) === title) {
    logStep(`comment analysis region already selected: ${title}`);
    return true;
  }

  await clickSelector(page, regionSelectSelector, 'region select');

  const regionOptionSelector = await waitForResolvedTargetSelector(
    page,
    `region-option:${title}`,
    `region option ${title}`,
  );
  await clickSelector(page, regionOptionSelector, `region option ${title}`);
  return true;
}

function buildForceDomClickScript(selector) {
  return `
    (() => {
      const selector = ${JSON.stringify(selector)};
      const target = document.querySelector(selector);
      if (!(target instanceof HTMLElement)) {
        return { ok: false, error: 'target_not_found' };
      }

      const clickable = target.closest('.t-tabs__nav-item, button, [role="button"], a, .t-button') || target;
      if (!(clickable instanceof HTMLElement)) {
        return { ok: false, error: 'clickable_not_found' };
      }

      clickable.scrollIntoView({ block: 'center', inline: 'center' });

      const rect = clickable.getBoundingClientRect();
      const clientX = Math.round(rect.left + Math.max(1, rect.width / 2));
      const clientY = Math.round(rect.top + Math.max(1, rect.height / 2));
      const eventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX,
        clientY,
        view: window,
      };

      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        try {
          clickable.dispatchEvent(new MouseEvent(type, eventInit));
        } catch {}
      }

      try {
        clickable.click();
      } catch {}

      return {
        ok: true,
        tag: clickable.tagName.toLowerCase(),
        className: clickable.className || '',
        text: String(clickable.textContent || '').trim(),
      };
    })()
  `;
}

function buildIsCommentDetailVisibleScript() {
  return `
    (() => {
      const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const lower = (value) => normalizeText(value).toLowerCase();
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const panel = document.querySelector('.comment-detail');
      const visiblePanel = panel instanceof HTMLElement && isVisible(panel);
      const activeTab = Array.from(document.querySelectorAll('.t-tabs__nav-item, .t-tabs__nav-item-wrapper'))
        .find((element) => {
          if (!(element instanceof HTMLElement)) return false;
          if (!element.classList.contains('t-is-active')) return false;
          return normalizeText(element.textContent).includes('评论详情');
        }) || null;
      const downloadCommentButton = Array.from(document.querySelectorAll('.item-btn button, .item-btn .t-button, button, .t-button'))
        .find((element) => {
          if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
          const text = lower(element.textContent);
          return text.includes('下载评论') || text.includes('download comment');
        }) || null;
      const commentTimeInput = Array.from(document.querySelectorAll('.t-range-input__inner-left input.t-input__inner, .t-date-range-picker input.t-input__inner, input'))
        .find((element) => {
          if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
          const joined = lower([
            element.getAttribute('placeholder'),
            element.getAttribute('aria-label'),
            element.getAttribute('name'),
            element.getAttribute('id'),
            element.parentElement?.textContent,
            element.closest('.item-data')?.textContent,
          ].filter(Boolean).join(' '));
          return joined.includes('评论时间') || joined.includes('comment time') || joined.includes('comment date');
        }) || null;
      const ratingFilter = Array.from(document.querySelectorAll('input.t-checkbox__former[type="checkbox"], label, .t-checkbox'))
        .find((element) => {
          if (!(element instanceof HTMLElement)) return false;
          const text = lower(
            element instanceof HTMLInputElement
              ? [element.value, element.parentElement?.textContent, element.closest('.item-data')?.textContent].filter(Boolean).join(' ')
              : element.textContent,
          );
          return text.includes('4星')
            || text.includes('3星')
            || text.includes('2星')
            || text.includes('1星')
            || text.includes('星级');
        }) || null;

      return {
        ok: true,
        visiblePanel,
        activeTabText: activeTab ? normalizeText(activeTab.textContent) : '',
        hasDownloadCommentButton: Boolean(downloadCommentButton),
        hasCommentTimeInput: Boolean(commentTimeInput),
        hasRatingFilter: Boolean(ratingFilter),
      };
    })()
  `;
}

function buildReadCommentSummaryUnavailableScript() {
  return `
    (() => {
      const expectedPath = '/my/analysis/newComment';
      const message = ${JSON.stringify(SHOPDORA_INSUFFICIENT_COMMENT_SUMMARY_MESSAGE)};
      const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const compactText = (value) => normalizeText(value).replace(/\\s+/g, '');
      let isNewCommentPage = false;
      try {
        isNewCommentPage = window.location.pathname.replace(/\\/+$/, '') === expectedPath;
      } catch {}

      const pageText = normalizeText(document.body?.textContent || '');
      const hasMessage = pageText.includes(message) || compactText(pageText).includes(compactText(message));
      return {
        ok: true,
        isNewCommentPage,
        hasMessage,
        message: hasMessage ? message : '',
      };
    })()
  `;
}

async function assertCommentSummaryAvailable(page) {
  let state = null;
  try {
    state = await page.evaluate(buildReadCommentSummaryUnavailableScript());
  } catch {
    return;
  }

  if (
    state
    && typeof state === 'object'
    && state.isNewCommentPage
    && state.hasMessage
  ) {
    throw new CommandExecutionError(
      SHOPDORA_INSUFFICIENT_COMMENT_SUMMARY_MESSAGE,
      'Shopdora requires at least 50 cumulative comments before this product can be analyzed.',
    );
  }
}

async function forceDomClick(page, selector, label) {
  const result = await page.evaluate(buildForceDomClickScript(selector));
  if (!result || typeof result !== 'object' || result.ok !== true) {
    throw new CommandExecutionError(`shopdora product-shopdora-download could not force-click ${label}`);
  }
  await sleepAction(page);
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
  logStep(`opening page: ${url}`);

  if (typeof page.newTab === 'function') {
    const created = await runWithFocusedWindow(() => page.newTab(url));
    if (typeof created === 'string' && created) {
      await page.selectTab(created);
      const settled = await waitForExpectedShopdoraUrl(page, url);
      if (settled.ok) {
        logStep(`page ready via newTab: ${settled.currentUrl}`);
        return { tabId: created, currentUrl: settled.currentUrl, navigationMode: 'newTab' };
      }

      log.warn(
        `${LOG_PREFIX} newTab did not land on target URL. expected=${url} actual=${settled.currentUrl || '(unknown)'}; retrying with goto`,
      );
    }
  }

  await page.goto(url, { waitUntil: 'load' });
  const settled = await waitForExpectedShopdoraUrl(page, url);
  if (settled.ok) {
    logStep(`page ready via goto: ${settled.currentUrl}`);
  } else {
    log.warn(`${LOG_PREFIX} page opened but URL mismatch. expected=${url} actual=${settled.currentUrl || '(unknown)'}`);
  }
  return { tabId: null, currentUrl: settled.currentUrl || url, navigationMode: 'goto' };
}

async function openShopdoraPageWithInterceptor(page, url, interceptorPattern) {
  logStep(`opening page before installing interceptor: ${url}`);
  const opened = await openShopdoraPage(page, url);
  logStep(`installing interceptor on loaded page: ${interceptorPattern}`);
  await page.installInterceptor(interceptorPattern);
  await installShopdoraApiUrlInterceptor(page);
  await sleepAction(page);
  logStep(`interceptor ready on current page: ${interceptorPattern}`);
  return opened;
}

async function refreshShopdoraPageDuringTaskWait(page, reason = 'task progress wait') {
  let currentUrl = '';
  try {
    currentUrl = await readCurrentPageUrl(page, SHOPDORA_COMMENT_ANALYSIS_URL);
  } catch {
    currentUrl = SHOPDORA_COMMENT_ANALYSIS_URL;
  }
  const targetUrl = currentUrl || SHOPDORA_COMMENT_ANALYSIS_URL;
  logStep(`refreshing Shopdora page during ${reason}: ${targetUrl}`);

  try {
    if (typeof page.goto === 'function') {
      await page.goto(targetUrl, { waitUntil: 'load' });
    } else if (typeof page.evaluate === 'function') {
      await page.evaluate('window.location.reload()');
      await sleep(page, 3);
    }
    await page.installInterceptor(SHOPDORA_API_CAPTURE_PATTERN);
    await installShopdoraApiUrlInterceptor(page);
    await sleepAction(page);

    const refreshedUrl = await readCurrentPageUrl(page, targetUrl);
    if (refreshedUrl.includes('/my/analysis/comment')) {
      await triggerCommentAnalysisQuery(page, `${reason} refresh`);
    }
  } catch (error) {
    log.warn(`${LOG_PREFIX} refresh during ${reason} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function triggerCommentAnalysisQuery(page, reason = 'commentAnalysis request') {
  const expectedItemId = typeof page?.__opencliShopdoraExpectedItemId === 'string'
    ? normalizeText(page.__opencliShopdoraExpectedItemId)
    : '';
  const expectedRegionTitle = typeof page?.__opencliShopdoraExpectedRegionTitle === 'string'
    ? normalizeText(page.__opencliShopdoraExpectedRegionTitle)
    : '';
  if (expectedItemId) {
    logStep(`filling comment analysis keyword with itemId: ${expectedItemId}`);
    const keywordInputSelector = await waitForResolvedTargetSelector(
      page,
      'comment-analysis-keyword-input',
      'comment analysis keyword input',
    );
    await setInputValue(page, keywordInputSelector, expectedItemId);
  }

  if (expectedRegionTitle) {
    await selectCommentAnalysisRegion(page, expectedRegionTitle);
  }

  logStep(`clicking query button to trigger ${reason}`);
  const queryButtonSelector = await waitForResolvedTargetSelector(page, 'query-button', 'query button');
  await clickSelector(page, queryButtonSelector, 'query button');

  if (typeof page.waitForCapture === 'function') {
    try {
      await page.waitForCapture(5);
      logStep('query-triggered interceptor capture signal received');
    } catch {
      logStep('query-triggered interceptor capture wait timed out; continuing with request polling');
    }
  }
}

async function openCommentDetailTabIfPresent(page) {
  let selector = '';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    selector = await tryResolveTargetSelector(page, 'comment-detail-tab');
    if (selector) break;
    await sleep(page, 0.25);
  }

  if (selector) {
    await forceDomClick(page, selector, 'comment-detail tab');
    return true;
  }

  try {
    const state = await page.evaluate(buildIsCommentDetailVisibleScript());
    if (state && typeof state === 'object' && state.ok === true) {
      if (state.visiblePanel) {
        return true;
      }
      if (normalizeText(state.activeTabText).includes('评论详情')) {
        return true;
      }
      if (state.hasDownloadCommentButton || state.hasCommentTimeInput || state.hasRatingFilter) {
        return true;
      }
    }
  } catch {
    // best-effort probe
  }
  return false;
}

function computeShiftedDateFromInputValue(value, monthOffset = COMMENT_TIME_MONTH_OFFSET, dayOffset = 0) {
  const normalized = String(value ?? '').trim();
  const match = normalized.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D.*)?$/);
  if (!match) {
    throw new CommandExecutionError(
      'shopdora product-shopdora-download could not parse the comment-time start date',
      `Unsupported input value: ${normalized || '(empty)'}`,
    );
  }

  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const target = new Date(Date.UTC(year, monthIndex, day));
  if (
    Number.isNaN(target.getTime())
    || target.getUTCFullYear() !== year
    || target.getUTCMonth() !== monthIndex
    || target.getUTCDate() !== day
  ) {
    throw new CommandExecutionError(
      'shopdora product-shopdora-download could not parse the comment-time start date',
      `Invalid input value: ${normalized}`,
    );
  }

  const originalDay = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + monthOffset);
  const daysInMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(originalDay, daysInMonth));
  target.setUTCDate(target.getUTCDate() + dayOffset);

  const yyyy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(target.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function setShiftedCommentTimeStartValue(page) {
  const inputSelector = await waitForResolvedTargetSelector(page, 'comment-time-start-input', 'comment-time start input');
  await clickSelector(page, inputSelector, 'comment-time start input');

  const rangeState = await page.evaluate(buildReadRangeInputValuesScript(inputSelector));
  if (!rangeState || typeof rangeState !== 'object' || !rangeState.ok) {
    throw new CommandExecutionError('shopdora product-shopdora-download could not read the comment-time start date');
  }

  const referenceValue = String(rangeState.endValue ?? '').trim() || String(rangeState.startValue ?? '').trim();
  const nextValue = computeShiftedDateFromInputValue(referenceValue);
  await setInputValue(page, inputSelector, nextValue);

  const enterResult = await page.evaluate(buildDispatchEnterOnInputScript(inputSelector));
  if (!enterResult || typeof enterResult !== 'object' || !enterResult.ok) {
    throw new CommandExecutionError('shopdora product-shopdora-download could not trigger Enter on the comment-time start date');
  }

  try {
    if (typeof page.nativeKeyPress === 'function') {
      await page.nativeKeyPress('Enter');
    } else {
      await page.pressKey('Enter');
    }
  } catch (error) {
    throw new CommandExecutionError(
      'shopdora product-shopdora-download could not submit the comment-time start date',
      error instanceof Error ? error.message : String(error),
    );
  }

  await sleepAction(page);
  return nextValue;
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

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readInterceptedEntryRequestBody(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return parseJsonObject(entry.requestBody ?? entry.request?.body ?? entry.requestData ?? null);
}

function readInterceptedEntryRequestHeaders(entry) {
  if (!entry || typeof entry !== 'object') return {};
  const headers = entry.requestHeaders ?? entry.request?.headers ?? {};
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)]),
  );
}

function makeShopdoraSign(data, timestamp) {
  const sorted = Object.prototype.toString.call(data) !== '[object Object]'
    ? String(timestamp)
    : Object.keys(data)
      .sort()
      .map((key) => (data[key] instanceof Object ? '' : `${key}${data[key]}`))
      .join('') + String(timestamp);

  return crypto
    .createHash('md5')
    .update(`${sorted}ddabcdshopdoradabcd${new Date().getFullYear()}`)
    .digest('hex')
    .toUpperCase();
}

function readTaskProgress(payload) {
  const progress = payload?.data?.progress;
  if (typeof progress === 'number') return progress;
  if (typeof progress === 'string' && /^\d+$/.test(progress)) return Number.parseInt(progress, 10);
  return null;
}

function isPluginQueryTaskEntry(entry) {
  const url = readInterceptedEntryUrl(entry);
  if (url) return url.includes('/api/plugin/queryTask');
  return readTaskProgress(parseInterceptedPayload(entry)) !== null;
}

function extractCommentAnalysisRows(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (payload.code !== 'ok') return [];
  const rows = payload?.data?.list;
  return Array.isArray(rows) ? rows : [];
}

function isCommentAnalysisPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.code !== 'ok') return false;
  if (!payload.data || typeof payload.data !== 'object') return false;
  if (!Array.isArray(payload.data.list)) return false;
  if ('totalCount' in payload.data || 'currentPage' in payload.data || 'totalPage' in payload.data) return true;
  return payload.data.list.some((row) => row && typeof row === 'object' && ('itemId' in row || 'taskKey' in row));
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

function isCommentAnalysisEntry(entry) {
  const url = readInterceptedEntryUrl(entry);
  if (url) return url.includes('/api/comment/commentAnalysis');
  return isCommentAnalysisPayload(parseInterceptedPayload(entry));
}

function extractCommentListRows(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const rows = payload?.data?.list;
  return Array.isArray(rows) ? rows : [];
}

function readCommentListPageInfo(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const currentPage = Number(data.currentPage ?? data.pageNum ?? data.page ?? 0) || 0;
  const totalPage = Number(data.totalPage ?? 0) || 0;
  const totalCount = Number(data.totalCount ?? data.total ?? 0) || 0;
  return { currentPage, totalPage, totalCount };
}

function isShopdoraCommentListUrl(value) {
  try {
    const url = new URL(String(value ?? ''), 'https://www.shopdora.com');
    return url.origin === 'https://www.shopdora.com' && url.pathname === '/api/comment/list';
  } catch {
    return false;
  }
}

function isCommentListEntry(entry) {
  const url = readInterceptedEntryUrl(entry);
  if (url) return isShopdoraCommentListUrl(url);
  return extractCommentListRows(parseInterceptedPayload(entry)).length > 0;
}

function isShopdoraCommentExportUrl(value) {
  try {
    const url = new URL(String(value ?? ''), 'https://www.shopdora.com');
    return url.origin === 'https://www.shopdora.com' && url.pathname === '/api/comment/export';
  } catch {
    return false;
  }
}

function isCommentExportEntry(entry) {
  const url = readInterceptedEntryUrl(entry);
  return Boolean(url && isShopdoraCommentExportUrl(url));
}

function buildCurlFromInterceptedEntry(entry) {
  const url = readInterceptedEntryUrl(entry) || SHOPDORA_COMMENT_EXPORT_API_URL;
  const requestHeaders = readInterceptedEntryRequestHeaders(entry);
  const requestBody = entry?.requestBody ?? entry?.request?.body ?? '';
  const shellQuote = (value) => `'${String(value ?? '').replace(/'/g, "'\\''")}'`;
  const parts = [`curl ${shellQuote(url)}`];
  for (const [key, value] of Object.entries(requestHeaders)) {
    if (!value) continue;
    parts.push(`  -H ${shellQuote(`${key}: ${value}`)}`);
  }
  if (requestBody) {
    parts.push(`  --data-raw ${shellQuote(requestBody)}`);
  }
  return parts.join(' \\\n');
}

function logCommentExportRequest(entry) {
  if (!entry) return;
  const requestBody = entry?.requestBody ?? entry?.request?.body ?? '';
  const requestHeaders = readInterceptedEntryRequestHeaders(entry);
  logStep(`captured comment/export request: url=${readInterceptedEntryUrl(entry) || '(empty)'}`);
  logStep(`comment/export request body: ${requestBody ? String(requestBody).slice(0, 2000) : '(empty)'}`);
  logStep(`comment/export request headers: ${Object.keys(requestHeaders).length ? JSON.stringify(requestHeaders) : '(empty)'}`);
  logStep(`comment/export request curl:\n${buildCurlFromInterceptedEntry(entry)}`);
}

async function readInterceptedRequestEntries(page) {
  if (typeof page?.getInterceptedRequests !== 'function') return [];
  try {
    const entries = await page.getInterceptedRequests();
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

async function waitForCommentExportRequest(page, baselineCount = 0, timeoutSeconds = 30) {
  if (typeof page?.getInterceptedRequests !== 'function') {
    logStep('comment/export request listener unavailable: getInterceptedRequests is not supported');
    return null;
  }

  const attempts = Math.max(1, Math.ceil(timeoutSeconds / 0.5));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const entries = await readInterceptedRequestEntries(page);
    const candidates = entries.length >= baselineCount ? entries.slice(baselineCount) : entries;
    logInterceptedApiEntries(`comment/export listener poll ${attempt + 1}/${attempts}`, candidates);
    const exportEntries = candidates.filter((entry) => isCommentExportEntry(entry));
    if (exportEntries.length > 0) {
      const entry = exportEntries[exportEntries.length - 1];
      logCommentExportRequest(entry);
      return entry;
    }
    await sleep(page, 0.5);
  }

  logStep('comment/export request was not captured before download finished/timeout');
  return null;
}

function pickBestCommentListEntry(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const entriesWithRequestBody = entries.filter((entry) => readInterceptedEntryRequestBody(entry));
  if (entriesWithRequestBody.length > 0) return entriesWithRequestBody[entriesWithRequestBody.length - 1];
  return entries[entries.length - 1] ?? null;
}

async function readInterceptedCommentListEntryCount(page) {
  if (typeof page?.getInterceptedRequests !== 'function') return 0;
  const entries = await page.getInterceptedRequests();
  logInterceptedApiEntries('comment/list baseline capture', entries);
  return 0;
}

async function waitForLastCommentListCapture(page, baselineCount = 0, timeoutSeconds = COMMENT_LIST_CAPTURE_TIMEOUT_SECONDS, canReturn = true) {
  if (typeof page?.getInterceptedRequests !== 'function') {
    throw new CommandExecutionError(
      'shopdora product-shopdora-download could not read comment list responses',
      'Browser interceptor request inspection is unavailable.',
    );
  }

  const canFinish = typeof canReturn === 'function' ? canReturn : () => Boolean(canReturn);
  const attempts = Math.max(1, Math.ceil(timeoutSeconds / 0.5));
  let lastRows = null;
  let lastPayload = null;
  let lastEntry = null;
  let stablePolls = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const entries = await page.getInterceptedRequests();
    logInterceptedApiEntries(`comment/list listener poll ${attempt + 1}/${attempts}`, entries);
    const relevantEntries = Array.isArray(entries) ? entries.filter((entry) => isCommentListEntry(entry)) : [];
    if (relevantEntries.length > 0) {
      lastEntry = pickBestCommentListEntry(relevantEntries);
      lastPayload = parseInterceptedPayload(lastEntry);
      lastRows = extractCommentListRows(lastPayload);
      stablePolls = 0;
      const pageInfo = readCommentListPageInfo(lastPayload);
      const hasRequestBody = Boolean(readInterceptedEntryRequestBody(lastEntry));
      logStep(
        `captured comment/list response: entries=${relevantEntries.length} rows=${lastRows.length} currentPage=${pageInfo.currentPage || '(empty)'} totalPage=${pageInfo.totalPage || '(empty)'} totalCount=${pageInfo.totalCount || '(empty)'} requestBody=${hasRequestBody ? 'yes' : 'no'}`,
      );
    } else if (lastRows) {
      stablePolls += 1;
      if (stablePolls >= 2 && canFinish()) {
        return { rows: lastRows, payload: lastPayload, entry: lastEntry };
      }
    }
    await sleep(page, 0.5);
  }

  if (lastRows && canFinish()) {
    return { rows: lastRows, payload: lastPayload, entry: lastEntry };
  }

  throw new CommandExecutionError(
    'shopdora product-shopdora-download timed out waiting for comment/list',
    `Filtering comments did not produce a captured ${SHOPDORA_COMMENT_LIST_API_URL} response.`,
  );
}

async function waitForLastCommentListRows(page, baselineCount = 0, timeoutSeconds = COMMENT_LIST_CAPTURE_TIMEOUT_SECONDS, canReturn = true) {
  const capture = await waitForLastCommentListCapture(page, baselineCount, timeoutSeconds, canReturn);
  return capture.rows;
}

async function fetchShopdoraCommentListPage(page, requestBody, requestHeaders, pageNum) {
  const payload = { ...requestBody, pageNum };
  const timestamp = Date.now().toString();
  const sign = makeShopdoraSign(payload, timestamp);
  const safeHeaders = {};
  for (const key of ['accept', 'accept-language', 'content-type', 'currency', 'endpoint', 'lang', 'shopdora-token']) {
    if (requestHeaders[key]) safeHeaders[key] = requestHeaders[key];
  }
  safeHeaders.accept = safeHeaders.accept || 'application/json, text/plain, */*';
  safeHeaders['content-type'] = safeHeaders['content-type'] || 'application/json';
  safeHeaders.currency = safeHeaders.currency || 'LOCAL';
  safeHeaders.endpoint = safeHeaders.endpoint || 'pc';
  safeHeaders.lang = safeHeaders.lang || 'zh';
  safeHeaders.timestamp = timestamp;
  safeHeaders.sign = sign;
  const requestBodyText = JSON.stringify(payload);

  const result = await page.evaluate(`
    (async () => {
      const headers = ${JSON.stringify(safeHeaders)};
      if (!headers['shopdora-token']) {
        const cookieToken = document.cookie
          .split('; ')
          .find((part) => part.startsWith('shopdora-token='))
          ?.split('=')
          .slice(1)
          .join('=');
        if (cookieToken) headers['shopdora-token'] = decodeURIComponent(cookieToken);
      }
      const body = ${JSON.stringify(requestBodyText)};
      const shellQuote = (value) => "'" + String(value).replace(/'/g, "'\\\\''") + "'";
      const curl = [
        'curl ' + shellQuote(${JSON.stringify(SHOPDORA_COMMENT_LIST_API_URL)}),
        ...Object.entries(headers).map(([key, value]) => '  -H ' + shellQuote(key + ': ' + value)),
        '  --data-raw ' + shellQuote(body),
      ].join(' \\\\\\n');
      try {
        const response = await fetch(${JSON.stringify(SHOPDORA_COMMENT_LIST_API_URL)}, {
          method: 'POST',
          credentials: 'include',
          headers,
          body,
        });
        const text = await response.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        return { ok: response.ok, status: response.status, text, json, curl };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          text: error instanceof Error ? error.message : String(error),
          json: null,
          curl,
        };
      }
    })()
  `);

  if (result?.curl) {
    logStep(`comment/list page ${pageNum} curl:\n${result.curl}`);
  }

  if (!result?.ok) {
    throw new CommandExecutionError(
      'shopdora product-shopdora-download could not fetch comment/list page',
      `pageNum=${pageNum} status=${result?.status ?? 0} response=${String(result?.text ?? '').slice(0, 200)}`,
    );
  }
  return result.json;
}

async function fetchRemainingCommentListRows(page, capture) {
  const firstRows = Array.isArray(capture?.rows) ? capture.rows : [];
  const pageInfo = readCommentListPageInfo(capture?.payload);
  const requestBody = readInterceptedEntryRequestBody(capture.entry);
  const currentPage = pageInfo.currentPage || (Number(requestBody?.pageNum ?? 0) || 0);
  const pageSize = Number(requestBody?.pageSize ?? 0) || firstRows.length || 0;
  const computedTotalPage = pageInfo.totalCount && pageSize ? Math.ceil(pageInfo.totalCount / pageSize) : 0;
  const totalPage = Math.max(pageInfo.totalPage, computedTotalPage);
  logStep(
    `comment/list pagination summary: capturedRows=${firstRows.length} currentPage=${currentPage || '(empty)'} apiTotalPage=${pageInfo.totalPage || '(empty)'} computedTotalPage=${computedTotalPage || '(empty)'} totalPage=${totalPage || '(empty)'} totalCount=${pageInfo.totalCount || '(empty)'} pageSize=${pageSize || '(empty)'}`,
  );
  if (!totalPage || !currentPage || currentPage >= totalPage) {
    logStep(`comment/list final rows: ${firstRows.length}`);
    return firstRows;
  }

  if (!requestBody) {
    logStep('comment/list request body was not captured; returning the final captured page only');
    logStep(`comment/list final rows: ${firstRows.length}`);
    return firstRows;
  }
  const requestHeaders = readInterceptedEntryRequestHeaders(capture.entry);
  const rows = [...firstRows];
  logStep(`comment/list pagination detected: currentPage=${currentPage} totalPage=${totalPage} totalCount=${pageInfo.totalCount}`);
  for (let pageNum = currentPage + 1; pageNum <= totalPage; pageNum += 1) {
    logStep(`fetching comment/list page ${pageNum}/${totalPage}: pageSize=${pageSize || '(empty)'}`);
    const payload = await fetchShopdoraCommentListPage(page, requestBody, requestHeaders, pageNum);
    const pageRows = extractCommentListRows(payload);
    const fetchedPageInfo = readCommentListPageInfo(payload);
    logStep(
      `fetched comment/list page ${pageNum}/${totalPage}: rows=${pageRows.length} currentPage=${fetchedPageInfo.currentPage || '(empty)'} totalPage=${fetchedPageInfo.totalPage || '(empty)'} totalCount=${fetchedPageInfo.totalCount || '(empty)'}`,
    );
    rows.push(...pageRows);
    logStep(`comment/list accumulated rows: ${rows.length}${pageInfo.totalCount ? `/${pageInfo.totalCount}` : ''}`);
  }
  logStep(`comment/list final rows: ${rows.length}${pageInfo.totalCount ? ` totalCount=${pageInfo.totalCount}` : ''}`);
  return rows;
}

async function clickDownloadCommentAndWait(page, context = {}) {
  if (typeof page?.waitForDownload !== 'function') {
    throw new CommandExecutionError(
      'shopdora product-shopdora-download requires browser download tracking support',
      'Reload the browser bridge extension/plugin to a build that supports download-wait.',
    );
  }

  const downloadButtonSelector = await waitForResolvedTargetSelector(
    page,
    'download-comment-button',
    'download comment button',
  );
  const baselineEntries = await readInterceptedRequestEntries(page);
  logInterceptedApiEntries('comment/export baseline before download click', baselineEntries);
  const exportRequestPromise = waitForCommentExportRequest(page, baselineEntries.length, 30);
  const downloadStartedAtMs = Date.now();
  logStep('clicking download comment button');
  await clickSelector(page, downloadButtonSelector, 'download comment button');

  logStep('waiting for comment download to finish');
  const [download, exportEntry] = await Promise.all([
    page.waitForDownload({
      startedAfterMs: downloadStartedAtMs,
      timeoutMs: DOWNLOAD_TIMEOUT_SECONDS * 1000,
    }),
    exportRequestPromise,
  ]);
  const localPath = String(download?.filename ?? '').trim();
  const remoteUrl = String(download?.finalUrl ?? download?.url ?? '').trim();
  if (!localPath && !remoteUrl) {
    throw new CommandExecutionError(
      'shopdora product-shopdora-download finished without a downloaded file URL',
      `download=${JSON.stringify(download ?? {})}`,
    );
  }

  const localUrl = localPath ? pathToFileURL(localPath).href : remoteUrl;
  logStep(`comment download completed: localUrl=${localUrl}`);
  return [{
    status: 'success',
    local_url: localUrl,
    local_path: localPath,
    download_url: remoteUrl,
    export_request_url: readInterceptedEntryUrl(exportEntry),
    export_request_body: String(exportEntry?.requestBody ?? exportEntry?.request?.body ?? ''),
    filename: localPath,
    source_url: remoteUrl,
    product_url: String(context.shopeeProductUrl ?? ''),
    taskKey: String(context.task?.taskKey ?? ''),
    site: String(context.task?.site ?? ''),
    shopId: String(context.task?.shopId ?? ''),
    itemId: String(context.task?.itemId ?? ''),
    mime: String(download?.mime ?? ''),
    fileSize: Number(download?.fileSize ?? 0) || 0,
  }];
}

function mapCommentAnalysisRowToTask(row, expected, fallbackProgress = null) {
  return {
    taskKey: String(row?.taskKey ?? ''),
    itemId: String(row?.itemId ?? ''),
    shopId: String(row?.shopId ?? expected.shopId ?? ''),
    site: String(row?.site ?? expected.site ?? ''),
    progress: Number(row?.progress ?? fallbackProgress ?? 0) || 0,
  };
}

function findTaskKeyInPayload(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return '';
  if (seen.has(value)) return '';
  seen.add(value);

  if (typeof value.taskKey === 'string' && value.taskKey.trim()) return value.taskKey.trim();
  if (typeof value.task_key === 'string' && value.task_key.trim()) return value.task_key.trim();

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTaskKeyInPayload(item, seen);
      if (found) return found;
    }
    return '';
  }

  for (const key of ['data', 'result', 'task', 'info', 'row']) {
    const found = findTaskKeyInPayload(value[key], seen);
    if (found) return found;
  }

  for (const item of Object.values(value)) {
    const found = findTaskKeyInPayload(item, seen);
    if (found) return found;
  }
  return '';
}

function mapCreatedTaskPayloadToTask(payload, expected) {
  const taskKey = findTaskKeyInPayload(payload);
  if (!taskKey) return null;
  const progress = Number(payload?.progress ?? payload?.data?.progress ?? 0) || 0;
  return {
    taskKey,
    itemId: String(payload?.itemId ?? payload?.data?.itemId ?? expected.itemId ?? ''),
    shopId: String(payload?.shopId ?? payload?.data?.shopId ?? expected.shopId ?? ''),
    site: String(payload?.site ?? payload?.data?.site ?? expected.site ?? ''),
    progress,
  };
}

function summarizeCommentAnalysisRows(rows, limit = 5) {
  if (!Array.isArray(rows) || rows.length === 0) return '(empty)';
  return rows
    .slice(0, limit)
    .map((row) => `itemId=${String(row?.itemId ?? '')}|taskKey=${String(row?.taskKey ?? '')}|progress=${String(row?.progress ?? '')}`)
    .join(', ');
}

function summarizeInterceptedEntryUrls(entries, limit = 5) {
  if (!Array.isArray(entries) || entries.length === 0) return '(none)';
  const urls = entries
    .map((entry) => readInterceptedEntryUrl(entry))
    .filter(Boolean)
    .slice(0, limit);
  return urls.length > 0 ? urls.join(', ') : '(no_urls)';
}

function summarizeInterceptedApiUrls(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '(none)';
  const urls = entries
    .map((entry) => readInterceptedEntryUrl(entry))
    .filter((url) => url.includes('/api/'));
  return urls.length > 0 ? urls.join(', ') : '(no_api_urls)';
}

function logInterceptedApiEntries(context, entries) {
  logStep(`${context}: apiUrls=${summarizeInterceptedApiUrls(entries)}`);
}

function summarizeInterceptedEntryBodies(entries, limit = 5) {
  if (!Array.isArray(entries) || entries.length === 0) return '(none)';
  const states = entries
    .slice(0, limit)
    .map((entry) => {
      const url = readInterceptedEntryUrl(entry) || '(no_url)';
      const rawPayload = entry?.body ?? entry?.responsePreview ?? null;
      const hasBody = typeof rawPayload === 'string'
        ? rawPayload.trim().length > 0
        : Boolean(rawPayload && typeof rawPayload === 'object');
      return `${url}|body=${hasBody ? 'yes' : 'no'}`;
    });
  return states.length > 0 ? states.join(', ') : '(none)';
}

async function fetchCommentAnalysisSnapshot(page) {
  const result = await page.evaluate(`
    (async () => {
      try {
        const response = await fetch('https://www.shopdora.com/api/comment/commentAnalysis', {
          method: 'GET',
          credentials: 'include',
          headers: {
            accept: 'application/json, text/plain, */*',
            'x-requested-with': 'XMLHttpRequest',
          },
        });
        const text = await response.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        return {
          ok: response.ok,
          status: response.status,
          json,
          text,
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          json: null,
          text: error instanceof Error ? error.message : String(error),
        };
      }
    })()
  `);

  const rows = extractCommentAnalysisRows(result?.json);
  return {
    ok: Boolean(result?.ok),
    status: Number(result?.status ?? 0) || 0,
    rows,
    text: typeof result?.text === 'string' ? result.text : '',
  };
}

async function fetchCommentAnalysisRows(page) {
  const snapshot = await fetchCommentAnalysisSnapshot(page);
  return snapshot.rows;
}

async function findExistingCommentAnalysisTask(page, expected) {
  const snapshot = await fetchCommentAnalysisSnapshot(page);
  const matched = selectMatchingCommentAnalysisRow(snapshot.rows, expected);
  return matched && matched.taskKey ? mapCommentAnalysisRowToTask(matched, expected) : null;
}

async function waitForDirectCommentAnalysisTask(page, expected, timeoutSeconds = EXISTING_TASK_DISCOVERY_SECONDS) {
  const attempts = Math.max(1, Math.ceil(timeoutSeconds / 0.5));
  let lastSnapshot = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const snapshot = await fetchCommentAnalysisSnapshot(page);
    lastSnapshot = snapshot;
    logStep(
      `direct commentAnalysis poll ${attempt + 1}/${attempts}: status=${snapshot.status} rows=${snapshot.rows.length} sample=${summarizeCommentAnalysisRows(snapshot.rows)}`,
    );

    const matched = selectMatchingCommentAnalysisRow(snapshot.rows, expected);
    if (matched && matched.taskKey) {
      return {
        task: mapCommentAnalysisRowToTask(matched, expected),
        snapshot,
      };
    }

    if (snapshot.rows.length > 0) {
      return { task: null, snapshot };
    }

    await sleep(page, 0.5);
  }

  return { task: null, snapshot: lastSnapshot };
}

async function waitForCompletedCommentAnalysisTask(page, expected, timeoutSeconds = RESULT_TIMEOUT_SECONDS, options = {}) {
  const attempts = Math.max(1, Math.ceil(timeoutSeconds / 1));
  let lastTask = null;
  const refreshIntervalSeconds = Number(options.refreshIntervalSeconds ?? TASK_PROGRESS_REFRESH_INTERVAL_SECONDS) || 0;
  let lastRefreshAt = Date.now();
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const snapshot = await fetchCommentAnalysisSnapshot(page);
    const matched = selectMatchingCommentAnalysisRow(snapshot.rows, expected);
    const task = matched?.taskKey ? mapCommentAnalysisRowToTask(matched, expected) : null;
    if (task) {
      lastTask = task;
      logStep(
        `active commentAnalysis completion poll ${attempt + 1}/${attempts}: progress=${task.progress} taskKey=${task.taskKey}`,
      );
      if (task.progress >= 100) return task;
    } else {
      logStep(
        `active commentAnalysis completion poll ${attempt + 1}/${attempts}: no matching task rows=${snapshot.rows.length}`,
      );
    }
    if (refreshIntervalSeconds > 0 && Date.now() - lastRefreshAt >= refreshIntervalSeconds * 1000) {
      lastRefreshAt = Date.now();
      await refreshShopdoraPageDuringTaskWait(page, 'commentAnalysis completion wait');
    }
    await sleep(page, 1);
  }

  if (lastTask) return lastTask;
  throw new EmptyResultError(
    'shopdora product-shopdora-download',
    'Timed out waiting for Shopdora comment analysis to finish and return a taskKey.',
  );
}

async function waitForPluginQueryTaskProgress(page, task, timeoutSeconds = RESULT_TIMEOUT_SECONDS, options = {}) {
  const attempts = Math.max(1, Math.ceil(timeoutSeconds / 0.5));
  let lastProgress = Number(task?.progress ?? 0) || 0;
  const refreshIntervalSeconds = Number(options.refreshIntervalSeconds ?? TASK_PROGRESS_REFRESH_INTERVAL_SECONDS) || 0;
  let lastRefreshAt = Date.now();

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const entries = await page.getInterceptedRequests();
    logInterceptedApiEntries(`plugin queryTask progress poll ${attempt + 1}/${attempts}`, entries);
    const queryTaskEntries = Array.isArray(entries) ? entries.filter((entry) => isPluginQueryTaskEntry(entry)) : [];
    for (const entry of queryTaskEntries) {
      const payload = parseInterceptedPayload(entry);
      const progress = readTaskProgress(payload);
      if (progress !== null) {
        lastProgress = progress;
        logStep(`plugin queryTask progress: ${progress}`);
        if (progress >= 100) {
          return { ...task, progress };
        }
      }
    }
    if (refreshIntervalSeconds > 0 && Date.now() - lastRefreshAt >= refreshIntervalSeconds * 1000) {
      lastRefreshAt = Date.now();
      await refreshShopdoraPageDuringTaskWait(page, 'plugin queryTask progress wait');
    }
    await sleep(page, 0.5);
  }

  throw new EmptyResultError(
    'shopdora product-shopdora-download',
    `Timed out waiting for Shopdora plugin queryTask progress to reach 100. Last progress=${lastProgress}`,
  );
}

function findMatchingCommentAnalysisTaskFromEntries(entries, expected) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const relevantEntries = entries.filter((entry) => isCommentAnalysisEntry(entry));
  for (let index = relevantEntries.length - 1; index >= 0; index -= 1) {
    const payload = parseInterceptedPayload(relevantEntries[index]);
    const rows = extractCommentAnalysisRows(payload);
    const matched = selectMatchingCommentAnalysisRow(rows, expected);
    if (matched && matched.taskKey) {
      return mapCommentAnalysisRowToTask(matched, expected);
    }
  }
  return null;
}

async function waitForExistingCommentAnalysisTask(page, expected, timeoutSeconds = EXISTING_TASK_DISCOVERY_SECONDS) {
  const result = await probeExistingCommentAnalysisTask(page, expected, timeoutSeconds);
  return result.task;
}

async function probeExistingCommentAnalysisTask(page, expected, timeoutSeconds = EXISTING_TASK_DISCOVERY_SECONDS) {
  const attempts = Math.max(1, Math.ceil(timeoutSeconds / 0.5));
  let lastMatchedTask = null;
  let sawCommentAnalysisResponse = false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const entries = await page.getInterceptedRequests();
    logInterceptedApiEntries(`commentAnalysis fallback poll ${attempt + 1}/${attempts}`, entries);
    const relevantEntries = Array.isArray(entries) ? entries.filter((entry) => isCommentAnalysisEntry(entry)) : [];
    logStep(
      `intercepted fallback poll ${attempt + 1}/${attempts}: totalEntries=${Array.isArray(entries) ? entries.length : 0} commentAnalysisEntries=${relevantEntries.length} sampleUrls=${summarizeInterceptedEntryUrls(entries)} sampleBodies=${summarizeInterceptedEntryBodies(relevantEntries)}`,
    );
    if (relevantEntries.length > 0) {
      sawCommentAnalysisResponse = true;
      const latestPayload = parseInterceptedPayload(relevantEntries[relevantEntries.length - 1]);
      const latestRows = extractCommentAnalysisRows(latestPayload);
      logStep(
        `intercepted commentAnalysis response: entries=${relevantEntries.length} rows=${latestRows.length} sample=${summarizeCommentAnalysisRows(latestRows)}`,
      );
    }
    const matchedTask = findMatchingCommentAnalysisTaskFromEntries(entries, expected);
    if (matchedTask) {
      lastMatchedTask = matchedTask;
      if (matchedTask.progress >= 100) {
        return { task: matchedTask, sawCommentAnalysisResponse };
      }
    }
    if (relevantEntries.length > 0) {
      return { task: lastMatchedTask, sawCommentAnalysisResponse };
    }
    await sleep(page, 0.5);
  }

  if (!sawCommentAnalysisResponse) {
    logStep(`intercepted commentAnalysis response: none captured within ${timeoutSeconds}s`);
  }

  return { task: lastMatchedTask, sawCommentAnalysisResponse };
}

async function refreshCommentAnalysisPageUnderInterceptor(page) {
  await triggerCommentAnalysisQuery(page, 'commentAnalysis request after retry');
}

function selectMatchingCommentAnalysisRow(rows, expected, options = {}) {
  const {
    allowShopIdFallback = true,
    allowLatestFallback = true,
  } = options && typeof options === 'object' ? options : {};
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const candidates = rows
    .filter((row) => row && typeof row === 'object' && row.taskKey)
    .filter((row) => {
      if (!expected.site) return true;
      const rowSite = String(row?.site ?? '').trim();
      return !rowSite || rowSite === expected.site;
    });
  if (candidates.length === 0) return null;

  if (expected.itemId) {
    const matchedByItemId = candidates.find((row) => {
      const sameItemId = String(row.itemId ?? '') === expected.itemId;
      if (!sameItemId) return false;
      if (!expected.shopId) return true;
      const rowShopId = String(row.shopId ?? '');
      return !rowShopId || rowShopId === expected.shopId;
    });
    if (matchedByItemId) return matchedByItemId;
    return null;
  }

  if (expected.shopId && allowShopIdFallback) {
    const matchedByShopId = candidates.find((row) => String(row.shopId ?? '') === expected.shopId);
    if (matchedByShopId) return matchedByShopId;
  }

  if (!allowLatestFallback) return null;

  return [...candidates].sort((left, right) => {
    const leftTime = Number.parseInt(String(left.createTime ?? left.time ?? left.analysisTime ?? '0'), 10) || 0;
    const rightTime = Number.parseInt(String(right.createTime ?? right.time ?? right.analysisTime ?? '0'), 10) || 0;
    return rightTime - leftTime;
  })[0] ?? null;
}

async function waitForTaskKey(page, expected, timeoutSeconds = RESULT_TIMEOUT_SECONDS) {
  const deadline = Date.now() + (timeoutSeconds * 1000);
  let sawProgress100 = false;
  let lastCommentRows = [];

  while (Date.now() < deadline) {
    const entries = await page.getInterceptedRequests();
    logInterceptedApiEntries('taskKey wait poll', entries);
    const allPayloads = Array.isArray(entries)
      ? entries.map((entry) => parseInterceptedPayload(entry)).filter(Boolean)
      : [];
    const commentAnalysisEntries = Array.isArray(entries)
      ? entries.filter((entry) => isCommentAnalysisEntry(entry))
      : [];
    const commentAnalysisPayloads = commentAnalysisEntries
      .map((entry) => parseInterceptedPayload(entry))
      .filter(Boolean);

    logStep(
      `waiting for taskKey via commentAnalysis: totalEntries=${Array.isArray(entries) ? entries.length : 0} commentAnalysisEntries=${commentAnalysisEntries.length} sampleUrls=${summarizeInterceptedEntryUrls(commentAnalysisEntries)}`,
    );

    for (const payload of allPayloads) {
      const progress = readTaskProgress(payload);
      if (progress === 100) {
        sawProgress100 = true;
      }
      const createdTask = isCommentAnalysisPayload(payload) ? null : mapCreatedTaskPayloadToTask(payload, expected);
      if (createdTask) {
        logStep(`created commentAnalysis task captured: taskKey=${createdTask.taskKey}`);
        return createdTask;
      }
    }

    for (const payload of commentAnalysisPayloads) {
      const rows = extractCommentAnalysisRows(payload);
      if (rows.length > 0) {
        lastCommentRows = rows;
        const matched = selectMatchingCommentAnalysisRow(rows, expected);
        if (matched && matched.taskKey) {
          return {
            taskKey: String(matched.taskKey),
            itemId: String(matched.itemId ?? ''),
            shopId: String(matched.shopId ?? expected.shopId ?? ''),
            site: String(matched.site ?? expected.site ?? ''),
            progress: Number(matched.progress ?? (sawProgress100 ? 100 : 0)) || 0,
          };
        }
      }
    }

    await sleep(page, 0.5);
  }

  if (lastCommentRows.length > 0) {
    const matched = selectMatchingCommentAnalysisRow(lastCommentRows, expected);
    if (matched && matched.taskKey) {
      return {
        taskKey: String(matched.taskKey),
        itemId: String(matched.itemId ?? ''),
        shopId: String(matched.shopId ?? expected.shopId ?? ''),
        site: String(matched.site ?? expected.site ?? ''),
        progress: Number(matched.progress ?? 0) || 0,
      };
    }
  }

  throw new EmptyResultError(
    'shopdora product-shopdora-download',
    'Timed out waiting for Shopdora comment analysis to finish and return a taskKey.',
  );
}

cli({
  site: 'shopdora',
  name: 'product-shopdora-download',
  access: 'read',
  description: 'Submit or reuse a Shopdora comment-analysis task for a Shopee product URL and download comments',
  domain: 'www.shopdora.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  timeoutSeconds: DOWNLOAD_TIMEOUT_SECONDS,
  args: [
    {
      name: 'shopeeProductUrl',
      positional: true,
      required: true,
      help: 'Shopee product URL, e.g. https://shopee.sg/...-i.123.456',
    },
  ],
  columns: OUTPUT_COLUMNS,
  func: async (page, args) => {
    if (!page) {
      throw new CommandExecutionError(
        'Browser session required for shopdora product-shopdora-download',
        'Run the command with the browser bridge connected',
      );
    }

    const shopeeProductUrl = normalizeShopeeProductUrl(args.shopeeProductUrl);
    const expected = {
      ...parseShopeeProductIdentifiers(shopeeProductUrl),
      site: deriveShopeeSiteFromUrl(shopeeProductUrl),
    };
    const expectedRegion = getShopeeRegionOptionFromUrl(shopeeProductUrl);
    page.__opencliShopdoraExpectedItemId = expected.itemId;
    page.__opencliShopdoraExpectedRegionTitle = expectedRegion?.title || '';

    logStep(`normalized Shopee product URL: ${shopeeProductUrl}`);
    logStep(`parsed target identifiers: site=${expected.site || '(empty)'} region=${expectedRegion?.title || '(empty)'} shopId=${expected.shopId || '(empty)'} itemId=${expected.itemId || '(empty)'}`);
    await openShopdoraPageWithInterceptor(page, SHOPDORA_COMMENT_ANALYSIS_URL, SHOPDORA_API_CAPTURE_PATTERN);
    logStep('checking Shopdora login state');
    const loginState = await readShopdoraLoginState(page);
    if (loginState.hasShopdoraLoginPage || loginState.hasPageDetailLoginTitle) {
      throw new AuthRequiredError('www.shopdora.com', `${SHOPDORA_NOT_LOGGED_IN_MESSAGE}，请先登录 Shopdora 后重试。`);
    }

    logStep('checking existing commentAnalysis tasks for this item');
    await triggerCommentAnalysisQuery(page, 'commentAnalysis request');
    let interceptedProbe = await probeExistingCommentAnalysisTask(page, expected, EXISTING_TASK_DISCOVERY_SECONDS);
    let task = interceptedProbe.task;

    let createdNewTask = false;
    if (!task?.taskKey) {
      logStep('intercepted commentAnalysis did not find the item; checking direct commentAnalysis fetch');
      const directCommentAnalysisResult = await waitForDirectCommentAnalysisTask(page, expected, EXISTING_TASK_DISCOVERY_SECONDS);
      const directCommentAnalysisSnapshot = directCommentAnalysisResult.snapshot;
      if (directCommentAnalysisSnapshot) {
        logStep(
          `direct commentAnalysis final: status=${directCommentAnalysisSnapshot.status} rows=${directCommentAnalysisSnapshot.rows.length} sample=${summarizeCommentAnalysisRows(directCommentAnalysisSnapshot.rows)}`,
        );
      }
      task = directCommentAnalysisResult.task;

      if (!task?.taskKey && !interceptedProbe.sawCommentAnalysisResponse) {
        logStep('no intercepted commentAnalysis seen after query click; retrying query button under active interceptor');
        await refreshCommentAnalysisPageUnderInterceptor(page);

        logStep('re-checking intercepted commentAnalysis after query retry');
        interceptedProbe = await probeExistingCommentAnalysisTask(page, expected, EXISTING_TASK_DISCOVERY_SECONDS);
        task = interceptedProbe.task;

        if (!task?.taskKey) {
          logStep('query retry still did not find the item via interceptor; re-running direct commentAnalysis fetch');
          const refreshedDirectCommentAnalysisResult = await waitForDirectCommentAnalysisTask(
            page,
            expected,
            EXISTING_TASK_DISCOVERY_SECONDS,
          );
          if (refreshedDirectCommentAnalysisResult.snapshot) {
            logStep(
              `direct commentAnalysis after query retry: status=${refreshedDirectCommentAnalysisResult.snapshot.status} rows=${refreshedDirectCommentAnalysisResult.snapshot.rows.length} sample=${summarizeCommentAnalysisRows(refreshedDirectCommentAnalysisResult.snapshot.rows)}`,
            );
          }
          task = refreshedDirectCommentAnalysisResult.task;
        }
      }
    }
    if (task?.taskKey) {
      if (task.progress >= 100) {
        logStep(`reusing existing commentAnalysis task: taskKey=${task.taskKey} progress=${task.progress}`);
      } else {
        logStep(`found existing commentAnalysis task: taskKey=${task.taskKey} progress=${task.progress}; waiting for plugin queryTask progress`);
        task = await waitForPluginQueryTaskProgress(page, task, RESULT_TIMEOUT_SECONDS);
      }
    }

    if (!task?.taskKey) {
      logStep('no existing commentAnalysis task found; opening add-product dialog');
      const addButtonSelector = await waitForResolvedTargetSelector(page, 'add-button', 'add button');
      await clickSelector(page, addButtonSelector, 'add button');

      logStep('filling product link');
      const productLinkInputSelector = await waitForResolvedTargetSelector(page, 'product-link-input', 'product-link input');
      await setInputValue(page, productLinkInputSelector, shopeeProductUrl);

      logStep('submitting product link');
      const submitButtonSelector = await waitForResolvedTargetSelector(page, 'submit-button', 'submit button');
      await clickSelector(page, submitButtonSelector, 'submit button');

      logStep('checking optional task creation confirmation');
      const confirmButtonSelector = await tryResolveTargetSelector(page, 'confirm-button');
      if (confirmButtonSelector) {
        logStep('confirming task creation');
        await clickSelector(page, confirmButtonSelector, 'confirm button');
      } else {
        logStep('task creation confirmation button not found; continuing to wait for task');
      }

      logStep('waiting briefly for created analysis task');
      try {
        task = await waitForTaskKey(page, expected, EXISTING_TASK_DISCOVERY_SECONDS);
        createdNewTask = Boolean(task?.taskKey);
      } catch (error) {
        if (!(error instanceof EmptyResultError)) throw error;
        logStep('created task was not immediately visible; refreshing commentAnalysis list');
        await triggerCommentAnalysisQuery(page, 'commentAnalysis request after task creation');
        const createdProbe = await probeExistingCommentAnalysisTask(page, expected, EXISTING_TASK_DISCOVERY_SECONDS);
        task = createdProbe.task;
        createdNewTask = Boolean(task?.taskKey);
        if (!task?.taskKey) {
          const refreshedDirectCommentAnalysisResult = await waitForDirectCommentAnalysisTask(
            page,
            expected,
            EXISTING_TASK_DISCOVERY_SECONDS,
          );
          task = refreshedDirectCommentAnalysisResult.task;
          createdNewTask = Boolean(task?.taskKey);
        }
        if (!task?.taskKey) {
          logStep('waiting for created analysis task completion after refresh');
          task = await waitForCompletedCommentAnalysisTask(page, expected, RESULT_TIMEOUT_SECONDS);
          createdNewTask = Boolean(task?.taskKey);
        }
      }
    }

    if (task?.taskKey && !createdNewTask && task.progress < 100) {
      logStep(`analysis task not ready yet: taskKey=${task.taskKey} progress=${task.progress}; waiting for plugin queryTask progress`);
      task = await waitForPluginQueryTaskProgress(page, task, RESULT_TIMEOUT_SECONDS);
    }

    const detailUrl = buildCommentDetailUrl(task);
    logStep(`analysis task link ready: taskKey=${task.taskKey} site=${task.site} shopId=${task.shopId} itemId=${task.itemId} progress=${task.progress}`);
    logStep(`opening comment detail page: ${detailUrl}`);

    await openShopdoraPage(page, detailUrl);
    logStep(`installing interceptor on comment detail page: ${SHOPDORA_API_CAPTURE_PATTERN}`);
    await page.installInterceptor(SHOPDORA_API_CAPTURE_PATTERN);
    await installShopdoraApiUrlInterceptor(page);
    await sleepAction(page);
    await assertCommentSummaryAvailable(page);
    const openedCommentDetailTab = await openCommentDetailTabIfPresent(page);
    if (openedCommentDetailTab) {
      logStep('comment detail tab is ready');
      await sleepAction(page);
    } else {
      await assertCommentSummaryAvailable(page);
      logStep('comment detail tab/detail panel not found after opening newComment; exiting early');
      throw new CommandExecutionError(
        'shopdora product-shopdora-download could not enter the comment detail view',
        `Opened ${detailUrl} but did not find a comment detail tab or visible detail panel.`,
      );
    }

    logStep('adjusting comment start date backward by 3 months');
    const shiftedStartDate = await setShiftedCommentTimeStartValue(page);
    logStep(`comment start date set to: ${shiftedStartDate}`);

    const detailCheckboxTargets = [
      ['rating-4-input', '4-star filter'],
      ['rating-3-input', '3-star filter'],
      ['rating-2-input', '2-star filter'],
      ['rating-1-input', '1-star filter'],
      ['media-checkbox-input', 'image/video filter'],
    ];

    for (const [target, label] of detailCheckboxTargets) {
      logStep(`enabling filter: ${label}`);
      const selector = await waitForResolvedTargetSelector(page, target, label);
      await ensureCheckboxState(page, selector, true, label);
      await sleep(page, 1);
    }

    return clickDownloadCommentAndWait(page, { shopeeProductUrl, task });
  },
});

export const __test__ = {
  SHOPDORA_COMMENT_ANALYSIS_URL,
  SHOPDORA_API_CAPTURE_PATTERN,
  SHOPDORA_COMMENT_DETAIL_URL,
  SHOPDORA_COMMENT_LIST_API_URL,
  SHOPDORA_COMMENT_EXPORT_API_URL,
  SHOPDORA_INSUFFICIENT_COMMENT_SUMMARY_MESSAGE,
  OUTPUT_COLUMNS,
  RESULT_TIMEOUT_SECONDS,
  DOWNLOAD_TIMEOUT_SECONDS,
  TASK_PROGRESS_REFRESH_INTERVAL_SECONDS,
  SHOPEE_REGION_OPTIONS,
  normalizeShopeeProductUrl,
  parseShopeeProductIdentifiers,
  deriveShopeeSiteFromUrl,
  getShopeeRegionOptionFromUrl,
  buildCommentDetailUrl,
  buildResolveTargetSelectorScript,
  buildSetInputValueScript,
  buildEnsureCheckboxStateScript,
  buildReadRegionSelectValueScript,
  selectCommentAnalysisRegion,
  buildForceDomClickScript,
  buildIsCommentDetailVisibleScript,
  buildReadCommentSummaryUnavailableScript,
  assertCommentSummaryAvailable,
  buildReadRangeInputValuesScript,
  buildInstallShopdoraApiUrlInterceptorScript,
  installShopdoraApiUrlInterceptor,
  parseInterceptedPayload,
  parseJsonObject,
  readInterceptedEntryRequestBody,
  readInterceptedEntryRequestHeaders,
  makeShopdoraSign,
  readTaskProgress,
  isPluginQueryTaskEntry,
  extractCommentAnalysisRows,
  isCommentAnalysisPayload,
  readInterceptedEntryUrl,
  isCommentAnalysisEntry,
  extractCommentListRows,
  isShopdoraCommentListUrl,
  isCommentListEntry,
  isShopdoraCommentExportUrl,
  isCommentExportEntry,
  buildCurlFromInterceptedEntry,
  waitForCommentExportRequest,
  summarizeInterceptedApiUrls,
  logInterceptedApiEntries,
  readCommentListPageInfo,
  pickBestCommentListEntry,
  findTaskKeyInPayload,
  mapCreatedTaskPayloadToTask,
  readInterceptedCommentListEntryCount,
  waitForLastCommentListCapture,
  waitForLastCommentListRows,
  fetchShopdoraCommentListPage,
  fetchRemainingCommentListRows,
  clickDownloadCommentAndWait,
  mapCommentAnalysisRowToTask,
  summarizeInterceptedEntryUrls,
  fetchCommentAnalysisRows,
  findExistingCommentAnalysisTask,
  waitForDirectCommentAnalysisTask,
  waitForCompletedCommentAnalysisTask,
  waitForPluginQueryTaskProgress,
  findMatchingCommentAnalysisTaskFromEntries,
  probeExistingCommentAnalysisTask,
  waitForExistingCommentAnalysisTask,
  selectMatchingCommentAnalysisRow,
  computeShiftedDateFromInputValue,
  setShiftedCommentTimeStartValue,
  runWithFocusedWindow,
  openShopdoraPage,
  openShopdoraPageWithInterceptor,
  refreshShopdoraPageDuringTaskWait,
  triggerCommentAnalysisQuery,
  refreshCommentAnalysisPageUnderInterceptor,
  openCommentDetailTabIfPresent,
  waitForTaskKey,
};
