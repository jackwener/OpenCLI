/**
 * Shared helpers for the Xiaohongshu DM (私信) adapters: dm-list, dm-read, dm-send.
 *
 * The web IM lives at https://www.xiaohongshu.com/chat and needs the main-site
 * login (separate from the creator center). Conversation cards are
 * `.xhs-im-conv-item[data-conv-id]`; one chat is `/chat/<conv-id>`; messages
 * render under `.xhs-im-msg-list`; the composer is `.xhs-im-input-bar-editor`.
 *
 * Everything that runs in the page context is inlined as a string because
 * injected scripts cannot import anything.
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { unwrapEvaluateResult } from './shared.js';

export const CHAT_URL = 'https://www.xiaohongshu.com/chat';
export const CHAT_SETTLE_MS = 4000;
export const SELECTOR_TIMEOUT_S = 15;
export const DEFAULT_CONVERSATION_LIMIT = 50;
export const DEFAULT_MESSAGE_LIMIT = 40;
export const MAX_MESSAGE_TEXT_CHARS = 500;

// 1:1 chats use a 24-char hex id; group chats use a numeric id.
const CONV_ID_RE = /^(?:[0-9a-f]{8,64}|\d{6,32})$/i;

export function assertConvId(raw) {
    const id = String(raw ?? '').trim();
    if (!CONV_ID_RE.test(id)) {
        throw new ArgumentError('xiaohongshu/dm: conv must be a conversation id from `opencli xiaohongshu dm-list`');
    }
    return id;
}

export function assertMessageText(raw) {
    const text = String(raw ?? '').trim();
    if (!text) throw new ArgumentError('xiaohongshu/dm-send: text cannot be empty');
    return text;
}

export function clampLimit(raw, fallback) {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function isXiaohongshuHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com');
}

/** The IM page shows a login modal (not a /login redirect) when logged out. */
export function looksLoggedOut(bodyText) {
    return /手机号登录|获取验证码|登录后查看/.test(String(bodyText || '').slice(0, 1200));
}

export function requireArray(payload, context) {
    const inner = unwrapEvaluateResult(payload);
    if (!Array.isArray(inner)) {
        throw new CommandExecutionError(`xiaohongshu/dm: malformed ${context} payload`);
    }
    return inner;
}

export function normalizeConversations(rows, limit) {
    return rows
        .filter((r) => r && typeof r === 'object' && typeof r.id === 'string' && r.id)
        .map((r) => ({
            id: r.id,
            name: String(r.name ?? '').trim(),
            time: String(r.time ?? '').trim(),
            summary: String(r.summary ?? '').trim(),
            unread: Number(r.unread) || 0,
            pinned: Boolean(r.pinned),
            group: /^\d+$/.test(r.id),
        }))
        .slice(0, limit);
}

export function normalizeMessages(rows, limit) {
    const cleaned = rows
        .filter((r) => r && typeof r === 'object' && typeof r.text === 'string' && r.text.trim())
        .map((r) => ({
            time: String(r.time ?? '').trim(),
            from: r.mine ? 'me' : String(r.from ?? '').trim(),
            mine: Boolean(r.mine),
            text: r.text.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_TEXT_CHARS),
        }));
    return limit > 0 ? cleaned.slice(-limit) : cleaned;
}

export const DISMISS_NOTICE_JS = `(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => /^我知道了$/.test((b.innerText || '').trim()));
  if (btn) { btn.click(); return true; }
  return false;
})()`;

export const CONVERSATIONS_JS = `(() => Array.from(document.querySelectorAll('.xhs-im-conv-item')).map((el) => {
  const text = (sel) => (el.querySelector(sel)?.innerText || '').trim();
  const unreadEl = el.querySelector('[class*="badge"], [class*="unread"], [class*="count"]');
  return {
    id: el.getAttribute('data-conv-id') || '',
    name: text('.xhs-im-conv-item__name'),
    time: text('.xhs-im-conv-item__time'),
    summary: text('.xhs-im-conv-item__summary-text'),
    unread: Number((unreadEl?.innerText || '').replace(/\\D/g, '')) || 0,
    pinned: el.classList.contains('xhs-im-conv-item--pinned'),
  };
}))()`;

export const MESSAGES_JS = `(() => {
  const list = document.querySelector('.xhs-im-msg-list');
  if (!list) return [];
  let time = '';
  const out = [];
  for (const el of Array.from(list.children)) {
    const cls = String(el.className || '');
    if (/time-divider/.test(cls)) { time = (el.innerText || '').trim(); continue; }
    const text = (el.innerText || '').trim();
    if (!text) continue;
    const mine = /--self|--mine|--right|is-self/.test(cls) || !!el.querySelector('[class*="self"], [class*="mine"], [class*="right"]');
    const from = (el.querySelector('[class*="name"], [class*="nick"]')?.innerText || '').trim();
    out.push({ time, from, mine, text });
  }
  return out;
})()`;

export const CLEAR_COMPOSER_JS = `(() => {
  const editor = document.querySelector('.xhs-im-input-bar-editor');
  if (!editor) return false;
  editor.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  return true;
})()`;

export function buildFallbackTypeJs(text) {
    return `(() => {
  const editor = document.querySelector('.xhs-im-input-bar-editor');
  if (!editor) return false;
  editor.focus();
  document.execCommand('insertText', false, ${JSON.stringify(text)});
  return true;
})()`;
}

export function buildWaitForEchoJs(text, attempts = 20, intervalMs = 400) {
    const needle = JSON.stringify(text.slice(0, 30));
    return `(async () => {
  for (let i = 0; i < ${attempts}; i += 1) {
    await new Promise((r) => setTimeout(r, ${intervalMs}));
    const list = document.querySelector('.xhs-im-msg-list');
    if (list && (list.innerText || '').includes(${needle})) return true;
  }
  return false;
})()`;
}

/**
 * Navigate to the IM page (or one chat), fail fast on a logged-out modal or
 * a login redirect, and dismiss the platform notice that can cover a chat.
 */
export async function openChat(page, convId) {
    if (!page) throw new CommandExecutionError('Browser session required for xiaohongshu dm commands');
    await page.goto(convId ? `${CHAT_URL}/${convId}` : CHAT_URL, { waitUntil: 'load', settleMs: CHAT_SETTLE_MS });

    const hrefRaw = unwrapEvaluateResult(await page.evaluate('() => location.href'));
    if (typeof hrefRaw !== 'string') throw new CommandExecutionError('xiaohongshu/dm: malformed current-url payload');
    const parsed = new URL(hrefRaw);
    if (parsed.protocol !== 'https:' || !isXiaohongshuHost(parsed.hostname)) {
        throw new CommandExecutionError(`xiaohongshu/dm: expected Xiaohongshu host, got ${parsed.hostname}`);
    }
    if (/\/login(?:[/?#]|$)/i.test(parsed.pathname)) throw new AuthRequiredError('www.xiaohongshu.com');

    const bodyText = unwrapEvaluateResult(await page.evaluate('() => document.body.innerText'));
    if (looksLoggedOut(bodyText)) {
        throw new AuthRequiredError(
            'www.xiaohongshu.com',
            'Not logged in to www.xiaohongshu.com (DMs need the main-site login, separate from the creator center)',
        );
    }
    await page.evaluate(DISMISS_NOTICE_JS);
}
