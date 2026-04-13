// ── Constants ───────────────────────────────────────────────────────────────
const BOSS_DOMAIN = 'www.zhipin.com';
const CHAT_URL = `https://${BOSS_DOMAIN}/web/chat/index`;
const COOKIE_EXPIRED_CODES = new Set([7, 37]);
const COOKIE_EXPIRED_MSG = 'Cookie 已过期！请在当前 Chrome 浏览器中重新登录 BOSS 直聘。';
const DEFAULT_TIMEOUT = 15_000;
// ── Core helpers ────────────────────────────────────────────────────────────
/**
 * Assert that page is available (non-null).
 */
export function requirePage(page) {
    if (!page)
        throw new Error('Browser page required');
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
        throw new Error(COOKIE_EXPIRED_MSG);
    }
}
/**
 * Throw if the API response is not code 0.
 * Checks for cookie expiry first, then throws with the provided message.
 */
export function assertOk(data, errorPrefix) {
    if (data.code === 0)
        return;
    checkAuth(data);
    const prefix = errorPrefix ? `${errorPrefix}: ` : '';
    throw new Error(`${prefix}${data.message || 'Unknown error'} (code=${data.code})`);
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
    const data = await page.evaluate(script);
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
    const data = await bossFetch(page, url);
    return data.zpData?.friendList || [];
}
/**
 * Fetch the recommended candidates (greetRecSortList).
 */
export async function fetchRecommendList(page) {
    const url = `https://${BOSS_DOMAIN}/wapi/zprelation/friend/greetRecSortList`;
    const data = await bossFetch(page, url);
    return data.zpData?.friendList || [];
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
        const friends = await fetchFriendList(page, { pageNum: p });
        const found = friends.find((f) => f.encryptUid === encryptUid);
        if (found)
            return found;
        if (friends.length === 0)
            break;
    }
    // Optionally check greet list
    if (checkGreetList) {
        const greetList = await fetchRecommendList(page);
        const found = greetList.find((f) => f.encryptUid === encryptUid);
        if (found)
            return found;
    }
    return null;
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
 * Verbose log helper — prints when OPENCLI_VERBOSE is set (via -v flag or env var).
 */
export function verbose(msg) {
    if (process.env.OPENCLI_VERBOSE) {
        console.error(`[opencli:boss] ${msg}`);
    }
}
