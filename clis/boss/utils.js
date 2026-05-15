import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

// ── Constants ───────────────────────────────────────────────────────────────
const BOSS_DOMAIN = 'www.zhipin.com';
const CHAT_URL = `https://${BOSS_DOMAIN}/web/chat/index`;
const COOKIE_EXPIRED_CODES = new Set([7, 37]);
const COOKIE_EXPIRED_MSG = 'Cookie 已过期！请在当前 Chrome 浏览器中重新登录 BOSS 直聘。';
const RECRUITER_ONLY_MSG = '该命令仅支持招聘端（BOSS 端）账号，请使用招聘者账号登录后重试。';
const DEFAULT_TIMEOUT = 15_000;
// ── Core helpers ────────────────────────────────────────────────────────────
/**
 * Assert that page is available (non-null).
 */
export function requirePage(page) {
    if (!page)
        throw new CommandExecutionError('Browser page required');
}
export function readPositiveInteger(raw, name, fallback, max) {
    const value = raw === undefined || raw === null || raw === '' ? fallback : Number(raw);
    if (!Number.isInteger(value) || value < 1) {
        throw new ArgumentError(`boss ${name} must be a positive integer`);
    }
    if (max !== undefined && value > max) {
        throw new ArgumentError(`boss ${name} must be <= ${max}`);
    }
    return value;
}
export function readRequiredString(raw, name) {
    const value = String(raw ?? '').trim();
    if (!value) {
        throw new ArgumentError(`boss ${name} cannot be empty`);
    }
    return value;
}
/**
 * Navigate to BOSS chat page and wait for it to settle.
 * This establishes the cookie context needed for subsequent API calls.
 */
export async function navigateToChat(page, waitSeconds = 2) {
    await page.goto(CHAT_URL);
    await page.wait({ time: waitSeconds });
}
/**
 * Navigate to a custom BOSS page (for search/detail that use different pages).
 */
export async function navigateTo(page, url, waitSeconds = 1) {
    await page.goto(url);
    await page.wait({ time: waitSeconds });
}
/**
 * Check if an API response indicates cookie expiry and throw a clear error.
 * Call this after every BOSS API response with a non-zero code.
 */
export function checkAuth(data) {
    if (COOKIE_EXPIRED_CODES.has(data.code)) {
        throw new AuthRequiredError(BOSS_DOMAIN, COOKIE_EXPIRED_MSG);
    }
}
/**
 * Map BOSS code=24 ("请切换身份后再试") to a typed AuthRequiredError.
 * Recruiter-only commands (recommend, joblist, stats, resume, mark,
 * exchange, invite, greet, batchgreet) have no geek-side equivalent;
 * surfacing this as a generic COMMAND_EXEC hides what the user must do.
 * chatlist / chatmsg avoid this path by using `allowNonZero: true` and
 * branching to the geek-side fetch when they see code 24.
 */
function checkRecruiterSide(data) {
    if (data.code === IDENTITY_MISMATCH_CODE) {
        throw new AuthRequiredError(BOSS_DOMAIN, RECRUITER_ONLY_MSG);
    }
}
/**
 * Throw if the API response is not code 0.
 * Checks for cookie expiry first, then identity mismatch, then throws
 * with the provided message.
 */
export function assertOk(data, errorPrefix) {
    if (!data || typeof data !== 'object') {
        throw new CommandExecutionError(`${errorPrefix ? `${errorPrefix}: ` : ''}Boss API returned malformed response`);
    }
    if (data.code === 0)
        return;
    checkAuth(data);
    checkRecruiterSide(data);
    const prefix = errorPrefix ? `${errorPrefix}: ` : '';
    throw new CommandExecutionError(`${prefix}${data.message || 'Unknown error'} (code=${data.code})`);
}
/**
 * Make a credentialed XHR request via page.evaluate().
 *
 * This is the single XHR template — no more copy-pasting the same 15-line
 * XMLHttpRequest boilerplate across every adapter.
 *
 * @returns Parsed JSON response
 * @throws On network error, timeout, JSON parse failure, or cookie expiry
 */
export async function bossFetch(page, url, opts = {}) {
    const method = opts.method ?? 'GET';
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    const body = opts.body ?? null;
    // Build the evaluate script. We use JSON.stringify for safe interpolation.
    const script = `
    async () => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(${JSON.stringify(method)}, ${JSON.stringify(url)}, true);
        xhr.withCredentials = true;
        xhr.timeout = ${timeout};
        xhr.setRequestHeader('Accept', 'application/json');
        ${method === 'POST' ? `xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');` : ''}
        xhr.onload = () => {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch(e) { reject(new Error('JSON parse failed: ' + xhr.responseText.substring(0, 200))); }
        };
        xhr.onerror = () => reject(new Error('Network Error'));
        xhr.ontimeout = () => reject(new Error('Timeout'));
        xhr.send(${body ? JSON.stringify(body) : 'null'});
      });
    }
  `;
    let data;
    try {
        data = await page.evaluate(script);
    } catch (error) {
        if (error instanceof AuthRequiredError || error instanceof CommandExecutionError) {
            throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new CommandExecutionError(`Boss API request failed: ${message}`);
    }
    if (!data || typeof data !== 'object') {
        throw new CommandExecutionError('Boss API returned malformed response');
    }
    // Auto-check auth unless caller opts out
    if (!opts.allowNonZero && data.code !== 0) {
        assertOk(data);
    }
    return data;
}
// ── Convenience helpers ─────────────────────────────────────────────────────
/**
 * Fetch the boss friend (chat) list.
 */
export async function fetchFriendList(page, opts = {}) {
    const pageNum = opts.pageNum ?? 1;
    const jobId = opts.jobId ?? '0';
    const url = `https://${BOSS_DOMAIN}/wapi/zprelation/friend/getBossFriendListV2.json?page=${pageNum}&status=0&jobId=${jobId}`;
    const data = await bossFetch(page, url, { allowNonZero: opts.allowNonZero });
    if (opts.allowNonZero && data.code !== 0) return data;
    const list = data.zpData?.friendList;
    if (!Array.isArray(list)) {
        throw new CommandExecutionError('Boss friend list response did not include zpData.friendList');
    }
    return list;
}
/**
 * Fetch the recommended candidates (greetRecSortList).
 */
export async function fetchRecommendList(page) {
    const url = `https://${BOSS_DOMAIN}/wapi/zprelation/friend/greetRecSortList`;
    const data = await bossFetch(page, url);
    const list = data.zpData?.friendList;
    if (!Array.isArray(list)) {
        throw new CommandExecutionError('Boss recommend response did not include zpData.friendList');
    }
    return list;
}
/**
 * Find a friend by encryptUid, searching through friend list and optionally greet list.
 * Returns null if not found.
 */
export async function findFriendByUid(page, encryptUid, opts = {}) {
    const maxPages = opts.maxPages ?? 1;
    const checkGreetList = opts.checkGreetList ?? false;
    // Search friend list pages
    for (let p = 1; p <= maxPages; p++) {
        const result = await fetchFriendList(page, { pageNum: p, allowNonZero: opts.allowNonZero });
        if (opts.allowNonZero && !Array.isArray(result)) {
            return { friend: null, code: result.code };
        }
        const friends = Array.isArray(result) ? result : [];
        const found = friends.find((f) => f.encryptUid === encryptUid);
        if (found)
            return opts.allowNonZero ? { friend: found, code: 0 } : found;
        if (friends.length === 0)
            break;
    }
    // Optionally check greet list
    if (checkGreetList) {
        const greetList = await fetchRecommendList(page);
        const found = greetList.find((f) => f.encryptUid === encryptUid);
        if (found)
            return opts.allowNonZero ? { friend: found, code: 0 } : found;
    }
    return opts.allowNonZero ? { friend: null, code: 0 } : null;
}
// ── UI automation helpers ───────────────────────────────────────────────────
/**
 * Click on a candidate in the chat list by their numeric UID.
 * @returns true if clicked, false if not found
 */
export async function clickCandidateInList(page, numericUid) {
    const uid = String(numericUid).replace(/[^0-9]/g, ''); // sanitize to digits only
    const result = await page.evaluate(`
    async () => {
      const uid = ${JSON.stringify(uid)};
      const item = document.querySelector('#_' + uid + '-0') || document.querySelector('[id^="_' + uid + '"]');
      if (item) {
        item.click();
        return { clicked: true };
      }
      const items = document.querySelectorAll('.geek-item');
      for (const el of items) {
        if (el.id && el.id.startsWith('_' + uid)) {
          el.click();
          return { clicked: true };
        }
      }
      return { clicked: false };
    }
  `);
    return result.clicked;
}
/**
 * Type a message into the chat editor and send it.
 * @returns true if sent successfully
 */
export async function typeAndSendMessage(page, text) {
    const typed = await page.evaluate(`
    async () => {
      const selectors = [
        '.chat-editor [contenteditable="true"]',
        '.chat-input [contenteditable="true"]',
        '.message-editor [contenteditable="true"]',
        '.chat-conversation [contenteditable="true"]',
        '[contenteditable="true"]',
        'textarea',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) {
          el.focus();
          if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
            el.value = ${JSON.stringify(text)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            el.textContent = '';
            el.focus();
            document.execCommand('insertText', false, ${JSON.stringify(text)});
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return { found: true };
        }
      }
      return { found: false };
    }
  `);
    if (!typed.found)
        return false;
    await page.wait({ time: 0.5 });
    // Click send button
    const sent = await page.evaluate(`
    async () => {
      const btn = document.querySelector('.conversation-editor .submit')
               || document.querySelector('.submit-content .submit')
               || document.querySelector('.conversation-operate .submit');
      if (btn) {
        btn.click();
        return { clicked: true };
      }
      return { clicked: false };
    }
  `);
    if (!sent.clicked) {
        await page.pressKey('Enter');
    }
    return true;
}
/**
 * Verbose log helper — prints when OPENCLI_VERBOSE is set.
 */
export function verbose(msg) {
    if (process.env.OPENCLI_VERBOSE) {
        console.error(`[opencli:boss] ${msg}`);
    }
}
// ── Geek-side helpers ────────────────────────────────────────────────────────
export const IDENTITY_MISMATCH_CODE = 24;
const GEEK_CHAT_URL = `https://${BOSS_DOMAIN}/web/geek/chat`;
/**
 * Navigate to the job-seeker chat page.
 * Establishes the cookie + JS-global context needed for geek-side API calls.
 */
export async function navigateToGeekChat(page, waitSeconds = 2) {
    await page.goto(GEEK_CHAT_URL);
    await page.wait({ time: waitSeconds });
}
/**
 * Read the encryptSystemId value required by the geek-side list API.
 * Strategy (in order):
 *   1. Vue app state / Pinia stores / $route.query (Option 1 — runtime source)
 *   2. performance.getEntriesByType('resource') — parse from geekFilterByLabel URL
 *      that the page itself already issued (Option 2 — most deterministic)
 *   3. cookie, inline <script> SSR state, known window globals, localStorage (fallbacks)
 * Returns empty string if nothing is found; the API may still succeed without it.
 * Caller must have navigated to the geek chat page first.
 */
export async function readEncryptSystemId(page) {
    const result = await page.evaluate(`
    (() => {
      // 1. Vue app state / Pinia / $route.query
      // The chat component reads encryptSystemId from the app runtime to build
      // its own geekFilterByLabel request, so the value lives in the Vue tree.
      try {
        const appEl = document.querySelector('#app') || document.querySelector('[data-v-app]');
        const vueApp = appEl && (appEl.__vue_app__ || appEl._vei);
        if (vueApp) {
          // 1a. Pinia stores (Vue 3 standard state management on BOSS直聘)
          const pinia = vueApp.config && vueApp.config.globalProperties.$pinia;
          if (pinia && pinia.state && pinia.state.value) {
            for (const store of Object.values(pinia.state.value)) {
              try {
                const flat = JSON.stringify(store);
                if (flat.includes('encryptSystemId')) {
                  const m = flat.match(/"encryptSystemId":"([^"]+)"/);
                  if (m) return m[1];
                }
              } catch (_) {}
            }
          }
          // 1b. Vue Router current route query
          const router = vueApp.config && vueApp.config.globalProperties.$router;
          const query = router && router.currentRoute && router.currentRoute.value && router.currentRoute.value.query;
          if (query && query.encryptSystemId) return query.encryptSystemId;
        }
      } catch (_) {}
      // 2. Performance resource entries — the page already issued geekFilterByLabel
      // with encryptSystemId in the URL; read it back from the resource timing API.
      try {
        const entries = performance.getEntriesByType('resource');
        for (const entry of entries) {
          if (!entry.name.includes('geekFilterByLabel')) continue;
          const u = new URL(entry.name);
          const v = u.searchParams.get('encryptSystemId');
          if (v) return v;
        }
      } catch (_) {}
      // 3. cookie
      try {
        const m = document.cookie.match(/encryptSystemId=([^;]+)/i);
        if (m) return decodeURIComponent(m[1]);
      } catch (_) {}
      // 4. inline <script> SSR state (Nuxt embeds server state here)
      try {
        for (const s of document.querySelectorAll('script:not([src])')) {
          const t = s.textContent || '';
          if (!t.includes('encryptSystemId')) continue;
          const m = t.match(/"encryptSystemId":"([^"]+)"/);
          if (m) return m[1];
        }
      } catch (_) {}
      // 5. known BOSS / Nuxt window globals
      const KNOWN = [
        '__NUXT__', '__INITIAL_STATE__', '__ZP_INFO__', '__BOSS_ZP__',
        'pageGlobalVar', 'ZP_DATA', '__ZP_DATA__', '__PAGE_DATA__',
      ];
      for (const k of KNOWN) {
        const obj = window[k];
        if (!obj || typeof obj !== 'object') continue;
        try {
          const flat = JSON.stringify(obj);
          if (!flat.includes('encryptSystemId')) continue;
          const m = flat.match(/"encryptSystemId":"([^"]+)"/);
          if (m) return m[1];
        } catch (_) {}
      }
      // 6. localStorage
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k) continue;
          if (k.toLowerCase().includes('encryptsystemid')) {
            const v = localStorage.getItem(k);
            if (v) return v;
          }
          const v = localStorage.getItem(k) || '';
          if (v.includes('encryptSystemId')) {
            const m = v.match(/"encryptSystemId":"([^"]+)"/);
            if (m) return m[1];
          }
        }
      } catch (_) {}
      return '';
    })()
  `);
    return result || '';
}
/**
 * Fetch the job-seeker chat list (brief info, no securityId).
 * Use fetchGeekFriendInfoList to enrich with securityId before calling chatmsg.
 */
export async function fetchGeekFriendLabelList(page, opts = {}) {
    const labelId = opts.labelId ?? 0;
    const encryptSystemId = opts.encryptSystemId ?? '';
    const url = `https://${BOSS_DOMAIN}/wapi/zprelation/friend/geekFilterByLabel?labelId=${labelId}&encryptSystemId=${encodeURIComponent(encryptSystemId)}`;
    const data = await bossFetch(page, url, { allowNonZero: opts.allowNonZero });
    if (opts.allowNonZero && data.code !== 0) return data;
    const list = data.zpData?.friendList;
    if (!Array.isArray(list)) {
        throw new CommandExecutionError('Boss geek chat list response did not include zpData.friendList');
    }
    return list;
}
/**
 * Enrich a batch of geek friends with full fields including securityId.
 * Processes in batches of 50 to avoid oversized request bodies.
 */
export async function fetchGeekFriendInfoList(page, friendIds = []) {
    if (!friendIds.length) return [];
    const BATCH_SIZE = 50;
    const results = [];
    for (let i = 0; i < friendIds.length; i += BATCH_SIZE) {
        const batch = friendIds.slice(i, i + BATCH_SIZE).map(String);
        const body = `friendIds=${batch.join(',')}`;
        const data = await bossFetch(page, `https://${BOSS_DOMAIN}/wapi/zprelation/friend/getGeekFriendList.json`, {
            method: 'POST',
            body,
        });
        const batchResult = data.zpData?.result;
        if (!Array.isArray(batchResult)) {
            throw new CommandExecutionError('Boss geek friend enrichment response did not include zpData.result');
        }
        results.push(...batchResult);
    }
    return results;
}
/**
 * Find a geek-side friend by encrypted uid.
 * Merges label-list and enriched data; returns null if not found.
 */
export async function findGeekFriendByUid(page, encryptUid, opts = {}) {
    const labelList = await fetchGeekFriendLabelList(page, { encryptSystemId: opts.encryptSystemId });
    const candidate = labelList.find((f) => f.encryptFriendId === encryptUid ||
        String(f.uid) === String(encryptUid) ||
        String(f.friendId) === String(encryptUid));
    if (!candidate) return null;
    const enriched = await fetchGeekFriendInfoList(page, [candidate.friendId]);
    return { ...candidate, ...(enriched[0] || {}) };
}
/**
 * Fetch message history for a geek-side chat.
 * friend must have .uid (boss's numeric id) and .securityId.
 */
export async function fetchGeekHistoryMsg(page, friend, opts = {}) {
    const pageNum = opts.page ?? 1;
    const bossId = friend.uid;
    const securityId = encodeURIComponent(friend.securityId || '');
    const url = `https://${BOSS_DOMAIN}/wapi/zpchat/geek/historyMsg?bossId=${bossId}&securityId=${securityId}&page=${pageNum}&c=20&src=0`;
    const data = await bossFetch(page, url);
    const messages = data.zpData?.messages ?? data.zpData?.historyMsgList;
    if (!Array.isArray(messages)) {
        throw new CommandExecutionError('Boss geek history response did not include a message list');
    }
    if (messages.length === 0) {
        throw new EmptyResultError('boss chatmsg', 'Boss returned no messages for this chat.');
    }
    return messages;
}
