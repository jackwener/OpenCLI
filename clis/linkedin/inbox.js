import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unwrapEvaluateResult(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload && 'session' in payload) return payload.data;
  return payload;
}

function normalizeUrl(url) {
  const raw = normalizeWhitespace(url);
  if (!raw) return '';
  try {
    const parsed = new URL(raw, 'https://www.linkedin.com');
    parsed.hash = '';
    // LinkedIn often appends tracking/search params; keep the canonical thread URL stable.
    if (parsed.pathname.includes('/messaging/thread/')) {
      return `https://www.linkedin.com${parsed.pathname}`;
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

function extractThreadId(url) {
  const raw = normalizeWhitespace(url);
  const match = raw.match(/\/messaging\/thread\/([^/?#]+)/i) || raw.match(/urn:li:fsd_conversation:([^\s"')]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
}

function looksLikeChromeOrNav(text) {
  return /^(messaging|focused|other|inmail|sponsored|compose|search messages|new message|settings|message requests)$/i.test(normalizeWhitespace(text));
}

function compactPreview(value, personName = '') {
  let text = normalizeWhitespace(value)
    .replace(/^(unread|未读)\s+/i, '')
    .replace(/\s+(mark as read|标记为已读)$/i, '')
    .replace(/\s+sent from linkedin for (iphone|android).*$/i, '')
    .trim();
  if (personName) {
    const escaped = personName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`^${escaped}\\s+`, 'i'), '').trim();
  }
  return text.slice(0, 500);
}

function inferTimestamp(text) {
  const clean = normalizeWhitespace(text);
  const patterns = [
    /\b(?:now|just now)\b/i,
    /\b\d+\s*(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|month|months|y|yr|yrs|year|years)\b/i,
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}\b/i,
    /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i,
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match) return match[0];
  }
  return '';
}

function inferUnread(root) {
  const blob = `${root.className || ''} ${root.getAttribute?.('aria-label') || ''} ${root.getAttribute?.('data-view-name') || ''} ${root.textContent || ''}`;
  if (/\bunread\b|未读/i.test(blob)) return true;
  const unreadEl = root.querySelector?.('[aria-label*="Unread" i], [class*="unread" i], [data-test-icon="unread"]');
  if (unreadEl) return true;
  const boldish = Array.from(root.querySelectorAll?.('*') || []).some((el) => {
    const style = globalThis.getComputedStyle ? globalThis.getComputedStyle(el) : null;
    const weight = Number(style?.fontWeight || 0);
    return weight >= 600 && /\S/.test(el.textContent || '');
  });
  return Boolean(boldish && /\b(message|sent|you:|you sent|replied|accepted|connected)\b/i.test(blob));
}

function personFromRoot(root) {
  const selectors = [
    '.msg-conversation-card__participant-names',
    '.msg-conversation-listitem__participant-names',
    '[data-anonymize="person-name"]',
    'span[dir="ltr"]',
    'h3',
    'a[href*="/in/"]',
  ];
  for (const selector of selectors) {
    const value = normalizeWhitespace(root.querySelector?.(selector)?.textContent || '');
    if (value && !looksLikeChromeOrNav(value) && !/^(you|sponsored)$/i.test(value)) return value;
  }
  const lines = normalizeWhitespace(root.innerText || root.textContent || '').split(/\s{2,}|\n/).map(normalizeWhitespace).filter(Boolean);
  return lines.find((line) => !looksLikeChromeOrNav(line) && !inferTimestamp(line) && line.length <= 80) || '';
}

function extractConversationFromRoot(root, currentUrl = '') {
  const link = root.querySelector?.('a[href*="/messaging/thread/"], a[href*="/messaging/compose"], a[href*="/in/"]');
  let threadUrl = normalizeUrl(link?.href || link?.getAttribute?.('href') || '');
  const currentThread = /\/messaging\/thread\//i.test(currentUrl || '') ? normalizeUrl(currentUrl) : '';
  // LinkedIn sometimes omits a row-level thread anchor for the active conversation.
  if (!threadUrl && /active conversation/i.test(root.getAttribute?.('aria-label') || root.textContent || '') && currentThread) {
    threadUrl = currentThread;
  }
  if (!/\/messaging\/thread\//i.test(threadUrl) && currentThread && root.matches?.('[aria-current="true"], .active, [class*="active"]')) {
    threadUrl = currentThread;
  }
  const text = normalizeWhitespace(root.innerText || root.textContent || '');
  const person = personFromRoot(root);
  const timestamp = normalizeWhitespace(root.querySelector?.('time')?.textContent || root.querySelector?.('.msg-conversation-card__time-stamp, .msg-conversation-listitem__time-stamp')?.textContent || inferTimestamp(text));
  let preview = normalizeWhitespace(root.querySelector?.('.msg-conversation-card__message-snippet, .msg-conversation-listitem__message-snippet, [class*="message-snippet"]')?.textContent || '');
  if (!preview) preview = compactPreview(text, person);
  const threadId = extractThreadId(threadUrl);
  const unread = inferUnread(root);
  if (!threadUrl && !person && !preview) return null;
  if (!threadUrl && preview.length < 2) return null;
  return {
    thread_url: threadUrl,
    thread_id: threadId,
    person_name: person,
    last_message_preview: preview,
    unread,
    timestamp,
  };
}

function extractInboxConversationsFromDocument(doc = globalThis.document, currentUrl = globalThis.location?.href || '') {
  const loginRequired = /\/login|\/checkpoint/i.test(String(currentUrl || ''))
    || Boolean(doc.querySelector('input[name="session_key"], form.login__form'));
  const selectors = [
    '.msg-conversation-listitem',
    '.msg-conversation-card',
    'li[id*="conversation" i]',
    '[data-view-name*="conversation" i]',
    '[role="listitem"]',
  ];
  const roots = [];
  const seen = new Set();
  for (const selector of selectors) {
    for (const el of Array.from(doc.querySelectorAll(selector))) {
      const text = normalizeWhitespace(el.innerText || el.textContent || '');
      const hasThread = Boolean(el.querySelector('a[href*="/messaging/thread/"]')) || /\/messaging\/thread\//i.test(text);
      const looksConversation = hasThread || /\b(unread|you:|sent|accepted|message|active conversation)\b/i.test(`${el.className || ''} ${el.getAttribute('aria-label') || ''} ${text}`);
      if (!looksConversation) continue;
      if (text.length < 2) continue;
      if (seen.has(el)) continue;
      seen.add(el);
      roots.push(el);
    }
  }
  const conversations = [];
  const dedupe = new Set();
  for (const root of roots) {
    const conv = extractConversationFromRoot(root, currentUrl);
    if (!conv) continue;
    const key = conv.thread_url || `${conv.person_name}::${conv.last_message_preview.slice(0, 80)}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    conversations.push(conv);
  }
  return { loginRequired, conversations };
}

function mergeConversations(existing, batch) {
  const byKey = new Map();
  for (const conv of existing) {
    const key = conv.thread_url || conv.thread_id || `${conv.person_name}::${conv.last_message_preview.slice(0, 80)}`;
    byKey.set(key, conv);
  }
  for (const conv of batch) {
    const normalized = {
      thread_url: normalizeWhitespace(conv.thread_url),
      thread_id: normalizeWhitespace(conv.thread_id || extractThreadId(conv.thread_url)),
      person_name: normalizeWhitespace(conv.person_name),
      last_message_preview: normalizeWhitespace(conv.last_message_preview),
      unread: Boolean(conv.unread),
      timestamp: normalizeWhitespace(conv.timestamp),
    };
    const key = normalized.thread_url || normalized.thread_id || `${normalized.person_name}::${normalized.last_message_preview.slice(0, 80)}`;
    if (!key.trim()) continue;
    const prior = byKey.get(key);
    byKey.set(key, prior ? { ...prior, ...normalized, unread: prior.unread || normalized.unread } : normalized);
  }
  return Array.from(byKey.values());
}

async function extractVisibleInbox(page) {
  return unwrapEvaluateResult(await page.evaluate(`(() => {
    const normalizeWhitespace = ${normalizeWhitespace.toString()};
    const normalizeUrl = ${normalizeUrl.toString()};
    const extractThreadId = ${extractThreadId.toString()};
    const looksLikeChromeOrNav = ${looksLikeChromeOrNav.toString()};
    const compactPreview = ${compactPreview.toString()};
    const inferTimestamp = ${inferTimestamp.toString()};
    const inferUnread = ${inferUnread.toString()};
    const personFromRoot = ${personFromRoot.toString()};
    const extractConversationFromRoot = ${extractConversationFromRoot.toString()};
    const extractInboxConversationsFromDocument = ${extractInboxConversationsFromDocument.toString()};
    const result = extractInboxConversationsFromDocument(document, location.href);
    if (result.conversations.length < 2) {
      const manual = Array.from(document.querySelectorAll('.msg-conversation-listitem, .msg-conversation-card')).map((root) => extractConversationFromRoot(root, location.href)).filter(Boolean);
      result.conversations = (${mergeConversations.toString()})(result.conversations, manual);
    }
    return result;
  })()`));
}

async function scrollInboxList(page) {
  return unwrapEvaluateResult(await page.evaluate(`(() => {
    function scrollableScore(el) {
      if (!el) return 0;
      return Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
    }
    const candidates = Array.from(document.querySelectorAll('main aside, aside, .msg-conversations-container__conversations-list, .msg-conversations-container, [role="main"], div'))
      .filter(el => scrollableScore(el) > 40)
      .sort((a, b) => scrollableScore(b) - scrollableScore(a));
    const target = candidates.find(el => /conversation|message|messaging/i.test(el.className || el.getAttribute('aria-label') || el.innerText || '')) || candidates[0] || document.scrollingElement || document.documentElement;
    const before = target.scrollTop || window.scrollY || 0;
    if (target === document.scrollingElement || target === document.documentElement || target === document.body) {
      window.scrollBy(0, Math.max(500, window.innerHeight * 0.85));
      return { before, after: window.scrollY || document.documentElement.scrollTop || 0, target: 'window' };
    }
    target.scrollTop = Math.min(target.scrollHeight, (target.scrollTop || 0) + Math.max(400, target.clientHeight * 0.85));
    return { before, after: target.scrollTop || 0, target: target.className || target.getAttribute('aria-label') || target.tagName };
  })()`));
}

async function clickLoadMoreOrNext(page) {
  return unwrapEvaluateResult(await page.evaluate(`(() => {
    const candidates = Array.from(document.querySelectorAll('button, a[role="button"], a[href]'));
    const el = candidates.find((node) => {
      const text = String(node.innerText || node.textContent || node.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
      return /^(show more|load more|see more|next)$/i.test(text) || /load more conversations|next page|show more conversations/i.test(text);
    });
    if (!el) return false;
    el.click();
    return true;
  })()`));
}

async function hydrateVisibleThreadUrls(page, conversations) {
  const hydrated = [];
  for (const conv of conversations) {
    if (conv.thread_url || !conv.person_name) {
      hydrated.push(conv);
      continue;
    }
    const targetName = conv.person_name;
    const clicked = unwrapEvaluateResult(await page.evaluate(`((targetName) => {
      const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
      const rows = Array.from(document.querySelectorAll('.msg-conversation-listitem, .msg-conversation-card'));
      const row = rows.find((el) => norm(el.querySelector('.msg-conversation-card__participant-names, .msg-conversation-listitem__participant-names, [data-anonymize="person-name"], span[dir="ltr"], h3')?.textContent) === targetName)
        || rows.find((el) => norm(el.innerText || el.textContent).includes(targetName));
      const clickable = row?.querySelector('.msg-conversation-listitem__link, [tabindex="0"], a, button') || row;
      if (!clickable) return false;
      clickable.click();
      return true;
    })(${JSON.stringify(targetName)})`));
    if (!clicked) {
      hydrated.push(conv);
      continue;
    }
    await page.wait(2);
    const url = unwrapEvaluateResult(await page.evaluate(`location.href`));
    const threadUrl = /\/messaging\/thread\//i.test(String(url || '')) ? normalizeUrl(url) : '';
    hydrated.push({
      ...conv,
      thread_url: conv.thread_url || threadUrl,
      thread_id: conv.thread_id || extractThreadId(threadUrl),
    });
  }
  return hydrated;
}

async function clickUnreadFilter(page) {
  return unwrapEvaluateResult(await page.evaluate(`(() => {
    const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], [role="tab"]'));
    const el = candidates.find((node) => String(node.innerText || node.textContent || node.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().toLowerCase() === 'unread');
    if (!el) return false;
    el.click();
    return true;
  })()`));
}

async function collectInboxView(page, url, limit, maxScrolls, options = {}) {
  await page.goto(url);
  await page.wait(5);
  let filterApplied = false;
  if (options.unreadFilter) {
    filterApplied = Boolean(await clickUnreadFilter(page));
    await page.wait(3);
  }
  let conversations = [];
  let sawLoginWall = false;
  let stablePasses = 0;
  for (let i = 0; i < maxScrolls && conversations.length < limit; i += 1) {
    const batch = await extractVisibleInbox(page);
    if (batch?.loginRequired) sawLoginWall = true;
    const before = conversations.length;
    conversations = mergeConversations(conversations, Array.isArray(batch?.conversations) ? batch.conversations : []);
    if (conversations.length === before) stablePasses += 1;
    else stablePasses = 0;
    if (conversations.length >= limit) break;
    const clicked = await clickLoadMoreOrNext(page);
    const scroll = await scrollInboxList(page);
    await page.wait(clicked ? 2 : 1);
    if (stablePasses >= 4 && scroll?.before === scroll?.after && !clicked) break;
  }
  return { sawLoginWall, conversations, filterApplied };
}

cli({
  site: 'linkedin',
  name: 'inbox',
  access: 'read',
  description: 'List LinkedIn messaging inbox conversations and unread messages',
  domain: 'www.linkedin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 40, help: 'Maximum conversations to return (max 200)' },
    { name: 'max-scrolls', type: 'int', default: 18, help: 'Maximum inbox scroll/pagination passes' },
    { name: 'unread-only', type: 'bool', default: false, help: 'Return only conversations detected as unread' },
  ],
  columns: ['rank', 'thread_url', 'thread_id', 'person_name', 'last_message_preview', 'unread', 'timestamp'],
  func: async (page, kwargs) => {
    const limit = Math.max(1, Math.min(kwargs.limit ?? 40, 200));
    const maxScrolls = Math.max(1, Math.min(kwargs['max-scrolls'] ?? 18, 80));
    const unreadOnly = Boolean(kwargs['unread-only']);
    const allView = await collectInboxView(page, 'https://www.linkedin.com/messaging/', limit, maxScrolls);
    // LinkedIn's normal inbox can hide unread rows; also sample the unread-filtered view and merge.
    const unreadView = await collectInboxView(page, 'https://www.linkedin.com/messaging/', limit, Math.max(6, Math.ceil(maxScrolls / 2)), { unreadFilter: true });
    if ((allView.sawLoginWall || unreadView.sawLoginWall) && allView.conversations.length === 0 && unreadView.conversations.length === 0) {
      throw new AuthRequiredError('linkedin.com', 'LinkedIn inbox requires an active signed-in browser session');
    }
    let conversations = mergeConversations(
      allView.conversations,
      unreadView.conversations.map((conv) => ({ ...conv, unread: unreadView.filterApplied ? true : conv.unread }))
    );
    if (unreadOnly) conversations = conversations.filter((conv) => conv.unread);
    if (!unreadOnly && conversations.some((conv) => !conv.thread_url && conv.person_name)) {
      await page.goto('https://www.linkedin.com/messaging/');
      await page.wait(3);
      conversations = await hydrateVisibleThreadUrls(page, conversations);
    }
    if (conversations.length === 0) {
      throw new EmptyResultError('linkedin inbox', 'No LinkedIn conversations were visible after scrolling/pagination.');
    }
    return conversations.slice(0, limit).map((conv, index) => ({ rank: index + 1, ...conv }));
  },
});

export const __test__ = {
  normalizeWhitespace,
  normalizeUrl,
  extractThreadId,
  inferTimestamp,
  inferUnread,
  extractConversationFromRoot,
  extractInboxConversationsFromDocument,
  mergeConversations,
};
