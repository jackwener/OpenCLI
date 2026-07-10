import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

const BASE_URL = 'https://sso.geiwohuo.com';
const LOGIN_URL = `${BASE_URL}/#/login`;
const AFTERSALES_LIST_URL = `${BASE_URL}/#/gsp/order-management/after-sales-list`;
const LIST_API = `${BASE_URL}/gsp/aftersalesOrder/list`;
const LOGIN_SUBMIT_WAIT_SECONDS = 2;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

function unwrapEvaluateResult(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'session' in payload && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

function parseCookieValue(cookie, name) {
  const match = String(cookie || '').match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function urlMatchesApi(rawUrl, apiUrl) {
  const value = stringValue(rawUrl);
  if (!value) return false;
  if (value.includes(apiUrl)) return true;
  try {
    return value.includes(new URL(apiUrl).pathname);
  } catch {
    return false;
  }
}

function parseJsonText(raw, label) {
  const text = stringValue(raw).trim();
  if (!text) throw new CommandExecutionError(`Missing ${label}`);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CommandExecutionError(`Malformed ${label}: ${error?.message || error}`);
  }
}

function buildCaptureListScript(timeoutMs = 30000) {
  return `
    (async () => {
      const pattern = ${JSON.stringify('/gsp/aftersalesOrder/list')};
      const timeoutMs = ${JSON.stringify(timeoutMs)};
      const captures = [];
      const errors = [];
      let finished = false;
      let resolveCapture;
      const capturePromise = new Promise((resolve) => { resolveCapture = resolve; });

      const visible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const textOf = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
      const pushCapture = (payload) => {
        captures.push(payload);
        if (!finished) {
          finished = true;
          resolveCapture(true);
        }
      };
      const readHeaders = (value) => {
        try {
          if (!value) return {};
          if (value instanceof Headers) return Object.fromEntries(value.entries());
          if (Array.isArray(value)) return Object.fromEntries(value.map(([k, v]) => [String(k), String(v)]));
          if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [String(k), String(v)]));
        } catch {}
        return {};
      };
      const readBody = async (body, request) => {
        try {
          if (body == null) return '';
          if (typeof body === 'string') return body;
          if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString();
          if (typeof FormData !== 'undefined' && body instanceof FormData) return '[formdata]';
          if (typeof Blob !== 'undefined' && body instanceof Blob) return '[blob]';
          if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return '[arraybuffer]';
          return String(body);
        } catch {}
        try {
          if (request) return await request.clone().text();
        } catch {}
        return '';
      };

      const origFetch = window.fetch;
      const xhrProto = XMLHttpRequest.prototype;
      const origOpen = xhrProto.open;
      const origSend = xhrProto.send;
      const origSetRequestHeader = xhrProto.setRequestHeader;

      window.fetch = async function (...args) {
        const request = args[0] instanceof Request ? args[0] : null;
        const init = args[1] || {};
        const reqUrl = request ? request.url : String(args[0] || '');
        const reqMethod = String(init.method || request?.method || 'GET').toUpperCase();
        const reqHeaders = readHeaders(init.headers || request?.headers);
        const reqBody = await readBody(init.body, request);
        const response = await origFetch.apply(this, args);
        if (pattern && reqUrl.includes(pattern)) {
          try {
            const text = await response.clone().text();
            pushCapture({
              kind: 'fetch',
              url: reqUrl,
              method: reqMethod,
              requestHeaders: reqHeaders,
              requestBodyPreview: reqBody,
              responseStatus: response.status,
              responsePreview: text,
              timestamp: Date.now(),
            });
          } catch (error) {
            errors.push({ kind: 'fetch', url: reqUrl, error: String(error) });
          }
        }
        return response;
      };

      xhrProto.open = function (method, url) {
        this.__opencliSheinAuthUrl = String(url || '');
        this.__opencliSheinAuthMethod = String(method || 'GET').toUpperCase();
        this.__opencliSheinAuthHeaders = {};
        return origOpen.apply(this, arguments);
      };

      xhrProto.setRequestHeader = function (name, value) {
        try {
          const headers = this.__opencliSheinAuthHeaders || {};
          headers[String(name)] = String(value);
          this.__opencliSheinAuthHeaders = headers;
        } catch {}
        return origSetRequestHeader.apply(this, arguments);
      };

      xhrProto.send = function (body) {
        const reqUrl = String(this.__opencliSheinAuthUrl || '');
        if (pattern && reqUrl.includes(pattern)) {
          const reqMethod = String(this.__opencliSheinAuthMethod || 'GET');
          const reqHeaders = this.__opencliSheinAuthHeaders || {};
          const reqBody = body == null ? '' : String(body);
          this.addEventListener('load', function () {
            try {
              pushCapture({
                kind: 'xhr',
                url: reqUrl,
                method: reqMethod,
                requestHeaders: reqHeaders,
                requestBodyPreview: reqBody,
                responseStatus: this.status,
                responsePreview: String(this.responseText || ''),
                timestamp: Date.now(),
              });
            } catch (error) {
              errors.push({ kind: 'xhr', url: reqUrl, error: String(error) });
            }
          }, { once: true });
        }
        return origSend.apply(this, arguments);
      };

      const restore = () => {
        try { window.fetch = origFetch; } catch {}
        try { xhrProto.open = origOpen; } catch {}
        try { xhrProto.send = origSend; } catch {}
        try { xhrProto.setRequestHeader = origSetRequestHeader; } catch {}
      };

      try {
        const deadline = Date.now() + Math.min(timeoutMs, 15000);
        let clicked = false;
        while (Date.now() < deadline) {
          const candidates = Array.from(document.querySelectorAll('button,[role="button"],.el-button,.ant-btn'))
            .filter((el) => visible(el) && textOf(el).includes('搜索'));
          const target = candidates.find((el) => textOf(el) === '搜索') || candidates[0];
          if (target) {
            target.click();
            clicked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!clicked) {
          return { ok: false, reason: 'search button not found', captures, errors, href: location.href, title: document.title || '', cookie: document.cookie || '' };
        }

        const timedOut = await Promise.race([
          capturePromise.then(() => false),
          new Promise((resolve) => setTimeout(() => resolve(true), timeoutMs)),
        ]);
        if (timedOut) {
          return { ok: false, reason: 'capture timeout', captures, errors, href: location.href, title: document.title || '', cookie: document.cookie || '' };
        }
        return { ok: true, captures, errors, href: location.href, title: document.title || '', cookie: document.cookie || '' };
      } finally {
        restore();
      }
    })()
  `;
}

function extractListCapture(entries) {
  const match = [...asArray(entries)].reverse().find((entry) => {
    const row = asObject(entry);
    return urlMatchesApi(row.url, LIST_API)
      && stringValue(row.responsePreview).trim()
      && Number(row.responseStatus) < 400;
  });
  if (!match) return null;
  return parseJsonText(match.responsePreview, 'SHEIN auth list response');
}

function ensureAuthPayload(payload, context = {}) {
  const code = payload?.code != null ? String(payload.code) : '';
  if (code === '20302') {
    throw new AuthRequiredError('sso.geiwohuo.com', 'SHEIN GSP session is not ready (code=20302)');
  }
  if (code && code !== '0') {
    throw new CommandExecutionError(`SHEIN auth probe failed: code=${code} msg=${payload?.msg || ''}`);
  }
  if (!payload || code !== '0') {
    throw new CommandExecutionError(`SHEIN auth probe returned an unreadable response: ${context.preview || ''}`);
  }
  return payload;
}

async function verifySheinIdentity(page) {
  await page.goto(AFTERSALES_LIST_URL);
  await page.wait(4);

  const probe = unwrapEvaluateResult(await page.evaluate(buildCaptureListScript()));
  if (asArray(probe?.errors).length > 0) {
    const first = asObject(asArray(probe.errors)[0]);
    throw new CommandExecutionError(`SHEIN auth capture failed: ${stringValue(first.error) || JSON.stringify(first)}`);
  }

  const href = stringValue(probe?.href);
  const title = stringValue(probe?.title);
  if (!probe?.ok) {
    if (!href.startsWith(BASE_URL) || /login|登录/i.test(`${href} ${title}`)) {
      throw new AuthRequiredError('sso.geiwohuo.com', 'SHEIN GSP session is not ready');
    }
    throw new CommandExecutionError(`SHEIN auth capture failed: ${stringValue(probe?.reason) || 'unknown reason'}`);
  }

  const payload = ensureAuthPayload(extractListCapture(probe.captures), {
    preview: JSON.stringify(asArray(probe.captures)[0] || {}).slice(0, 180),
  });
  const cookie = String(probe.cookie || '');
  const data = Array.isArray(payload?.info?.data) ? payload.info.data : [];
  const first = data.find(item => item && typeof item === 'object') || {};
  return {
    site_id: parseCookieValue(cookie, 'SITE_ID'),
    store_site: parseCookieValue(cookie, 'gsp_store_site') || first.site || '',
    page_title: title,
  };
}

async function pollSheinIdentity(page) {
  return verifySheinIdentity(page);
}

function envValue(name) {
  return typeof process !== 'undefined' && process?.env ? stringValue(process.env[name]) : '';
}

function buildAutofillLoginScript(username, password) {
  return `
    (async () => {
      const username = ${JSON.stringify(username)};
      const password = ${JSON.stringify(password)};
      if (!username || !password) return { ok: false, reason: 'missing credentials' };

      const visible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const textOf = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
      const setValue = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value')?.set
          || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter ? setter.call(el, value) : (el.value = value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      };

      const deadline = Date.now() + 20000;
      let userInput;
      let passwordInput;
      while (Date.now() < deadline) {
        const inputs = Array.from(document.querySelectorAll('input')).filter(visible);
        passwordInput = inputs.find((input) => String(input.type || '').toLowerCase() === 'password');
        userInput = inputs.find((input) => {
          if (input === passwordInput) return false;
          const type = String(input.type || 'text').toLowerCase();
          if (!['', 'text', 'email', 'tel', 'number'].includes(type)) return false;
          const hint = [input.name, input.id, input.placeholder, input.autocomplete].map((v) => String(v || '').toLowerCase()).join(' ');
          return /user|account|login|phone|mobile|email|账号|账户|用户名|手机号|邮箱/.test(hint) || inputs.indexOf(input) < inputs.indexOf(passwordInput);
        });
        if (userInput && passwordInput) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (!userInput || !passwordInput) {
        return { ok: false, reason: 'login inputs not found', href: location.href, title: document.title || '' };
      }

      userInput.focus();
      setValue(userInput, username);
      passwordInput.focus();
      setValue(passwordInput, password);

      const buttons = Array.from(document.querySelectorAll('button,[role="button"],.el-button,.ant-btn')).filter(visible);
      const submit = buttons.find((button) => /登录|登陆|sign\\s*in|log\\s*in/i.test(textOf(button)))
        || buttons.find((button) => {
          const type = String(button.getAttribute('type') || '').toLowerCase();
          return type === 'submit';
        })
        || buttons[0];
      if (!submit) return { ok: false, reason: 'login button not found', href: location.href, title: document.title || '' };
      submit.click();
      return { ok: true, href: location.href, title: document.title || '' };
    })()
  `;
}

async function autofillSheinLogin(page, kwargs) {
  const username = stringValue(kwargs.username || envValue('SHEIN_USERNAME') || envValue('SHEIN_USER')).trim();
  const password = stringValue(kwargs.password || envValue('SHEIN_PASSWORD') || envValue('SHEIN_PASS'));
  if (!username || !password) return;

  const result = unwrapEvaluateResult(await page.evaluate(buildAutofillLoginScript(username, password)));
  if (!result?.ok) {
    throw new CommandExecutionError(`SHEIN automatic login failed: ${stringValue(result?.reason) || 'unknown reason'}`);
  }
  await page.wait(LOGIN_SUBMIT_WAIT_SECONDS);
}

registerSiteAuthCommands({
  site: 'shein',
  domain: 'sso.geiwohuo.com',
  loginUrl: LOGIN_URL,
  columns: ['store_site', 'site_id', 'page_title'],
  loginDescription: 'Open SHEIN seller login and wait until the GSP session is ready',
  whoamiDescription: 'Check whether the SHEIN seller GSP session is ready',
  loginArgs: [
    { name: 'username', help: 'SHEIN login username; defaults to SHEIN_USERNAME or SHEIN_USER env var' },
    { name: 'password', help: 'SHEIN login password; defaults to SHEIN_PASSWORD or SHEIN_PASS env var' },
  ],
  afterOpenLogin: autofillSheinLogin,
  verify: verifySheinIdentity,
  poll: pollSheinIdentity,
});

export const __test__ = {
  buildCaptureListScript,
  buildAutofillLoginScript,
  extractListCapture,
  parseCookieValue,
};
