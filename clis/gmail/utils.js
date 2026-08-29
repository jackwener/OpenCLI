import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
  TimeoutError,
} from '@jackwener/opencli/errors';

export const GMAIL_ORIGIN = 'https://mail.google.com';
export const GMAIL_HOST = 'mail.google.com';
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 200;
const PAGE_SIZE = 50;
const CAPTURE_WAIT_SECONDS = 10;
const MAX_BODY_CHARS = 20_000;

export function unwrapBrowserResult(value, label = 'browser probe') {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'session' in value) {
    if (typeof value.session === 'string' && Object.prototype.hasOwnProperty.call(value, 'data')) {
      return value.data;
    }
    throw new CommandExecutionError(`Gmail ${label} returned a malformed Browser Bridge envelope`);
  }
  return value;
}

export function parseLimit(raw, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) {
  const value = raw ?? fallback;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ArgumentError('limit must be a positive integer');
  }
  if (limit > max) {
    throw new ArgumentError(`limit must be <= ${max}`);
  }
  return limit;
}

export function parseAccount(raw) {
  const value = raw ?? 0;
  const account = Number(value);
  if (!Number.isInteger(account) || account < 0 || account > 20) {
    throw new ArgumentError('account must be an integer between 0 and 20');
  }
  return account;
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function gmailDate(value, label) {
  let timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new CommandExecutionError(`Gmail ${label} had an invalid timestamp`);
  }
  if (timestamp < 10_000_000_000) timestamp *= 1000;
  if (timestamp > 10_000_000_000_000) timestamp /= 1000;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new CommandExecutionError(`Gmail ${label} had an invalid timestamp`);
  }
  return date.toISOString();
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function htmlToText(value) {
  return decodeEntities(String(value || '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseJsonCapture(entry, operation) {
  const status = Number(entry?.responseStatus || 0);
  if (status === 401 || status === 403) {
    throw new AuthRequiredError(GMAIL_HOST, `Gmail ${operation} returned HTTP ${status}`);
  }
  if (status !== 200) {
    throw new CommandExecutionError(`Gmail ${operation} returned HTTP ${status || 'unknown'}`);
  }
  if (entry?.responseBodyTruncated === true) {
    throw new CommandExecutionError(`Gmail ${operation} response exceeded the browser capture limit`);
  }
  const body = entry?.responsePreview;
  if (Array.isArray(body)) return body;
  if (typeof body !== 'string') {
    throw new CommandExecutionError(`Gmail ${operation} response body was unavailable`);
  }
  try {
    const parsed = JSON.parse(body.replace(/^\)\]\}'\s*/, ''));
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed;
  } catch {
    throw new CommandExecutionError(`Gmail ${operation} returned malformed JSON`);
  }
}

function addressRef(value) {
  if (!Array.isArray(value)) return null;
  const address = cleanString(value[1]);
  if (!address.includes('@')) return null;
  return { address, name: cleanString(value[2]) || null };
}

function senderFromSummary(message) {
  return addressRef(Array.isArray(message) ? message[1] : null);
}

function labelIdsFromMessages(messages) {
  return [...new Set((Array.isArray(messages) ? messages : [])
    .flatMap((message) => Array.isArray(message?.[10]) ? message[10] : [])
    .filter((label) => typeof label === 'string' && label.startsWith('^')))];
}

export function parseBatchView(body) {
  if (!Array.isArray(body) || body.length !== 19) {
    throw new CommandExecutionError('Gmail batch-view response had an unexpected shape');
  }
  const rows = Array.isArray(body[2]) ? body[2] : [];
  return rows.map((wrapper, index) => {
    const record = Array.isArray(wrapper?.[0]) ? wrapper[0] : null;
    if (!record || record.length < 5) {
      throw new CommandExecutionError(`Gmail batch-view returned a malformed thread at index ${index}`);
    }
    const threadId = cleanString(record[3]).replace(/^#/, '');
    const messages = Array.isArray(record[4]) ? record[4] : [];
    const latest = messages.at(-1);
    const sender = senderFromSummary(latest);
    if (!threadId) throw new CommandExecutionError(`Gmail batch-view returned a thread without an id at index ${index}`);
    const labels = labelIdsFromMessages(messages);
    return {
      threadId,
      subject: cleanString(record[0]) || '(no subject)',
      from: sender?.address || null,
      fromName: sender?.name || null,
      snippet: cleanString(record[1]) || null,
      messageCount: messages.length,
      unread: labels.includes('^u'),
      starred: labels.includes('^t'),
      date: gmailDate(record[2], `thread ${threadId}`),
      labels,
    };
  });
}

function labelCounts(value) {
  const result = new Map();
  const rows = Array.isArray(value?.[0]) ? value[0] : [];
  for (const row of rows) {
    const id = cleanString(row?.[0]);
    if (!id) continue;
    result.set(id, {
      unread: Number.isFinite(Number(row?.[1])) ? Number(row[1]) : null,
      total: Number.isFinite(Number(row?.[2])) ? Number(row[2]) : null,
    });
  }
  return result;
}

export function parseLabels(body) {
  if (!Array.isArray(body) || body.length !== 19) {
    throw new CommandExecutionError('Gmail batch-view response had an unexpected shape');
  }
  const counts = labelCounts(body[6]);
  const rows = Array.isArray(body[1]) ? body[1] : [];
  return rows.map((wrapper, index) => {
    const record = Array.isArray(wrapper?.[0]) ? wrapper[0] : null;
    const id = cleanString(record?.[0]);
    if (!id) throw new CommandExecutionError(`Gmail returned a malformed label at index ${index}`);
    const count = counts.get(id) || {};
    return {
      id,
      name: cleanString(record?.[1]) || id,
      type: id.startsWith('^x_') ? 'user' : 'system',
      unreadCount: count.unread ?? null,
      totalCount: count.total ?? null,
    };
  });
}

function senderFromRecord(record) {
  const card = Array.isArray(record?.[10]) ? record[10] : null;
  const address = cleanString(card?.[16]);
  if (!address.includes('@')) return null;
  return { address, name: cleanString(card?.[14]) || null };
}

function addressList(value) {
  return (Array.isArray(value) ? value : []).map(addressRef).filter(Boolean);
}

function messageBody(record) {
  const block = Array.isArray(record?.[5]) ? record[5] : [];
  const plain = cleanString(Array.isArray(block[4]) ? block[4][6] : '');
  let html = '';
  for (const part of Array.isArray(block[1]) ? block[1] : []) {
    html += cleanString(Array.isArray(part?.[2]) ? part[2][1] : '');
  }
  const text = plain && !/[.#@][\w-]+\s*\{[^}]+\}/.test(plain.slice(0, 500))
    ? plain
    : (htmlToText(html) || plain || cleanString(record?.[6]));
  const clipped = Number(block[2]) === 1 ? '\n\n[message clipped by Gmail]' : '';
  return `${text.slice(0, MAX_BODY_CHARS)}${clipped}`.trim();
}

function parseAttachments(record) {
  const out = [];
  for (const wrapper of Array.isArray(record?.[13]) ? record[13] : []) {
    const node = Array.isArray(wrapper?.[0]) ? wrapper[0] : null;
    const data = Array.isArray(node?.[3]) ? node[3] : null;
    const attachmentId = cleanString(node?.[1]);
    if (!data || !attachmentId) continue;
    out.push({
      attachmentId,
      name: cleanString(data[2]) || null,
      mimeType: cleanString(data[3]) || null,
      size: Number.isFinite(Number(data[4])) ? Number(data[4]) : null,
    });
  }
  return out;
}

export function parseFetchData(body) {
  if (!Array.isArray(body) || !Array.isArray(body[1])) {
    throw new CommandExecutionError('Gmail fetch-data response had an unexpected shape');
  }
  const messages = [];
  for (const threadWrapper of body[1]) {
    const threadId = cleanString(threadWrapper?.[0]).replace(/^#/, '');
    const rows = Array.isArray(threadWrapper?.[2]) ? threadWrapper[2] : [];
    for (const wrapper of rows) {
      const messageId = cleanString(wrapper?.[0]).replace(/^#/, '');
      const record = Array.isArray(wrapper?.[1]) ? wrapper[1] : null;
      if (!threadId || !messageId || !record) {
        throw new CommandExecutionError('Gmail fetch-data returned a malformed message');
      }
      const from = senderFromRecord(record);
      const attachments = parseAttachments(record);
      messages.push({
        messageId,
        legacyMessageId: cleanString(record[34]) || null,
        threadId,
        subject: cleanString(record[4]) || '(no subject)',
        from: from?.address || null,
        fromName: from?.name || null,
        to: addressList(record[0]).map((item) => item.address).join(', ') || null,
        cc: addressList(record[1]).map((item) => item.address).join(', ') || null,
        date: gmailDate(record[16], `message ${messageId}`),
        snippet: cleanString(record[6]) || null,
        body: messageBody(record) || null,
        attachments,
      });
    }
  }
  return messages;
}

async function ensureGmailReady(page, account, operation) {
  const currentUrl = typeof page.getCurrentUrl === 'function' ? await page.getCurrentUrl() : null;
  if (!currentUrl?.startsWith(`${GMAIL_ORIGIN}/mail/u/${account}/`)) {
    await page.goto(`${GMAIL_ORIGIN}/mail/u/${account}/#inbox`);
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = unwrapBrowserResult(await page.evaluate(`() => !!document.querySelector('input[name="q"]')`), `${operation} readiness probe`);
    if (ready === true) return;
    await page.sleep(0.5);
  }
  throw new TimeoutError(`Gmail ${operation} page`, 30, 'The Gmail search surface did not become ready. Reload Gmail in the browser and retry.');
}

async function installGmailCapture(page, account, endpoint, operation) {
  if (
    typeof page?.startNetworkCapture !== 'function'
    || typeof page?.readNetworkCapture !== 'function'
  ) {
    throw new CommandExecutionError(`Gmail ${operation} requires browser response interception`);
  }
  if (!await page.startNetworkCapture(`/sync/u/${account}/i/${endpoint}`)) {
    throw new CommandExecutionError(`Gmail ${operation} could not start browser response interception`);
  }
  await page.readNetworkCapture();
}

async function waitGmailCaptures(page, endpoint, operation, timeoutSeconds = CAPTURE_WAIT_SECONDS) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let bodylessCaptureObserved = false;
  // The bridge capture queue is request-oriented: reading it while a response
  // is still in flight drains that request before its status/body arrive.
  // Give Gmail's own action time to settle before the first read.
  await page.sleep(endpoint === 'fd' ? 1 : 3);
  while (Date.now() < deadline) {
    const entries = await page.readNetworkCapture();
    const endpointEntries = (Array.isArray(entries) ? entries : [])
      .filter((entry) => String(entry?.url || '').includes(`/i/${endpoint}`));
    if (endpointEntries.some((entry) => (
      typeof entry?.responsePreview !== 'string'
      && entry?.responseBodyTruncated !== true
    ))) {
      bodylessCaptureObserved = true;
    }
    const matches = endpointEntries.filter((entry) => (
      typeof entry?.responsePreview === 'string' || entry?.responseBodyTruncated === true
    ));
    if (matches.length > 0) {
      await page.sleep(1);
      const settled = await page.readNetworkCapture();
      const settledEndpointEntries = (Array.isArray(settled) ? settled : [])
        .filter((entry) => String(entry?.url || '').includes(`/i/${endpoint}`));
      if (settledEndpointEntries.some((entry) => (
        typeof entry?.responsePreview !== 'string'
        && entry?.responseBodyTruncated !== true
      ))) {
        bodylessCaptureObserved = true;
      }
      matches.push(...settledEndpointEntries.filter((entry) => (
        typeof entry?.responsePreview === 'string' || entry?.responseBodyTruncated === true
      )));
      if (bodylessCaptureObserved) {
        throw new CommandExecutionError(
          `Gmail ${operation} capture included a response without a body; refusing possibly partial results`,
        );
      }
      return matches.map((entry) => parseJsonCapture(entry, operation));
    }
    await page.sleep(0.25);
  }
  if (bodylessCaptureObserved) {
    throw new CommandExecutionError(
      `Gmail ${operation} capture lost a response body; refusing possibly partial results`,
    );
  }
  throw new TimeoutError(`Gmail ${operation} capture`, timeoutSeconds, `No /${endpoint} response was observed after the Gmail action.`);
}

async function renderedLabels(page, account) {
  await page.goto(`${GMAIL_ORIGIN}/mail/u/${account}/#settings/labels`);
  await page.sleep(2);
  const rows = unwrapBrowserResult(await page.evaluate(`() => {
    const routes = new RegExp('^(?:#(?:inbox|starred|snoozed|sent|drafts|important|spam|trash)|#label/)');
    const systemNames = {
      inbox: 'Inbox', starred: 'Starred', snoozed: 'Snoozed', sent: 'Sent',
      drafts: 'Drafts', important: 'Important', spam: 'Spam', trash: 'Trash',
      scheduled: 'Scheduled', all: 'All Mail',
      'category/purchases': 'Purchases', 'category/social': 'Social',
      'category/updates': 'Updates', 'category/forums': 'Forums',
      'category/promotions': 'Promotions',
    };
    const seen = new Set();
    const result = [];
    const add = (id, name, type, unreadCount = null) => {
      const key = String(id || '').toLowerCase();
      if (!key || !name || seen.has(key)) return;
      seen.add(key);
      result.push({ id, name, type, unreadCount, totalCount: null });
    };
    for (const link of document.querySelectorAll('a[href]')) {
      const href = String(link.getAttribute('href') || '');
      if (!routes.test(href)) continue;
      const raw = String(link.getAttribute('aria-label') || link.getAttribute('title') || link.textContent || '').trim();
      const route = decodeURIComponent(href.slice(1));
      const systemName = systemNames[route];
      const name = systemName || (route.startsWith('label/') ? route.slice(6) : raw.replace(/\\s+\\d[\\d,]*\\s*$/, '').trim());
      if (!name) continue;
      const count = raw.match(/(?:^|\\s)(\\d[\\d,]*)\\s*$/)?.[1];
      add(route, name, systemName ? 'system' : 'user', count ? Number(count.replace(/,/g, '')) : null);
    }
    const headings = new Set([
      'labels', 'label', 'system labels', 'categories', 'create new label',
      'show in label list', 'show in message list', 'actions',
    ]);
    for (const row of document.querySelectorAll('[role="main"] tr, main tr')) {
      const cell = row.querySelector('td');
      const name = String(cell?.innerText || cell?.textContent || '').split('\\n').map((text) => text.trim()).find(Boolean) || '';
      if (!name || headings.has(name.toLowerCase()) || /^note:/i.test(name) || name.length > 120) continue;
      const systemKey = Object.keys(systemNames).find((key) => systemNames[key].toLowerCase() === name.toLowerCase());
      add(systemKey || 'label/' + name, name, systemKey ? 'system' : 'user');
    }
    return result;
  }`), 'rendered labels');
  return Array.isArray(rows) ? rows : [];
}

async function renderedThread(page, target) {
  const rows = unwrapBrowserResult(await page.evaluate(`() => {
    const subject = String(document.querySelector('h2[data-thread-perm-id], h2.hP')?.textContent || '').trim() || '(no subject)';
    const seen = new Set();
    const result = [];
    for (const node of document.querySelectorAll('[data-message-id]')) {
      const messageId = String(node.getAttribute('data-message-id') || '').trim();
      if (!messageId || seen.has(messageId)) continue;
      const bodyNode = node.querySelector('.a3s.aiL, .a3s');
      if (!bodyNode) continue;
      seen.add(messageId);
      const sender = node.querySelector('.gD[email], span[email]');
      const dateNode = node.querySelector('.g3[title], [data-tooltip*="202"], [title]');
      const attachments = [];
      for (const attachment of node.querySelectorAll('.aQH, [download_url]')) {
        const name = String(attachment.querySelector('.aV3')?.textContent || attachment.getAttribute('aria-label') || '').trim();
        if (!name || attachments.some((item) => item.name === name)) continue;
        attachments.push({
          attachmentId: String(attachment.getAttribute('data-attachment-id') || '') || null,
          name,
          mimeType: null,
          size: null,
        });
      }
      result.push({
        messageId,
        legacyMessageId: String(node.getAttribute('data-legacy-message-id') || '') || null,
        subject,
        from: String(sender?.getAttribute('email') || '').trim() || null,
        fromName: String(sender?.getAttribute('name') || sender?.textContent || '').trim() || null,
        to: null,
        cc: null,
        dateText: String(dateNode?.getAttribute('title') || dateNode?.textContent || '').trim(),
        snippet: null,
        body: String(bodyNode.innerText || bodyNode.textContent || '').trim(),
        attachments,
      });
    }
    return result;
  }`), 'rendered thread');
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const parsedDate = row.dateText ? new Date(row.dateText) : null;
    return {
      ...row,
      threadId: cleanString(target).replace(/^#/, ''),
      date: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
      body: cleanString(row.body).slice(0, MAX_BODY_CHARS) || null,
    };
  }).map(({ dateText: _dateText, ...row }) => row);
}

async function submitSearch(page, query, operation) {
  const prepared = unwrapBrowserResult(await page.evaluate(`() => {
    const field = document.querySelector('input[name="q"]');
    if (!field) return false;
    field.focus();
    field.select();
    return true;
  }`), `${operation} search preparation`);
  if (prepared !== true) throw new CommandExecutionError(`Gmail ${operation} could not find the search input`);
  if (typeof page.nativeType !== 'function') {
    throw new CommandExecutionError(`Gmail ${operation} requires native browser input`);
  }
  await page.nativeType(query);
  const actual = unwrapBrowserResult(await page.evaluate(`() => document.querySelector('input[name="q"]')?.value || ''`), `${operation} search input verification`);
  if (actual !== query) throw new CommandExecutionError(`Gmail ${operation} could not set the search query exactly`);
  if (typeof page.cdp === 'function') {
    const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await page.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  } else if (typeof page.nativeKeyPress === 'function') {
    await page.nativeKeyPress('Enter');
  } else {
    throw new CommandExecutionError(`Gmail ${operation} requires native browser keyboard input`);
  }
}

export async function queryThreads(page, query, { account = 0, limit = DEFAULT_LIMIT } = {}) {
  const normalizedQuery = cleanString(query);
  if (!normalizedQuery) throw new ArgumentError('Gmail search query cannot be empty');
  await ensureGmailReady(page, account, 'thread list');
  await installGmailCapture(page, account, 'bv', 'thread list');

  const rows = [];
  const seen = new Set();
  const pages = Math.ceil(limit / PAGE_SIZE);
  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    if (pageNumber === 1) {
      await submitSearch(page, normalizedQuery, 'thread list');
    } else {
      const target = unwrapBrowserResult(await page.evaluate(`() => {
        const labels = /(older|较旧|較舊|下一页|下一頁)/i;
        const button = Array.from(document.querySelectorAll('button, [role="button"]')).find((node) => {
          const value = [node.getAttribute('aria-label'), node.getAttribute('data-tooltip'), node.getAttribute('title')]
            .filter(Boolean).join(' ');
          const rect = node.getBoundingClientRect();
          return labels.test(value) && node.getAttribute('aria-disabled') !== 'true' && rect.width > 0 && rect.height > 0;
        });
        if (!button) return { found: false };
        const rect = button.getBoundingClientRect();
        return { found: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }`), 'thread pagination');
      if (!target?.found) break;
      if (typeof page.nativeClick === 'function') await page.nativeClick(target.x, target.y);
      else {
        const clicked = unwrapBrowserResult(await page.evaluate(`() => {
          const labels = /(older|较旧|較舊|下一页|下一頁)/i;
          const button = Array.from(document.querySelectorAll('button, [role="button"]')).find((node) => {
            const value = [node.getAttribute('aria-label'), node.getAttribute('data-tooltip'), node.getAttribute('title')]
              .filter(Boolean).join(' ');
            const rect = node.getBoundingClientRect();
            return labels.test(value) && node.getAttribute('aria-disabled') !== 'true' && rect.width > 0 && rect.height > 0;
          });
          if (!button) return false;
          button.click();
          return true;
        }`), 'thread pagination click');
        if (clicked !== true) break;
      }
    }
    const bodies = await waitGmailCaptures(
      page,
      'bv',
      pageNumber === 1 ? 'thread list' : `thread pagination page ${pageNumber}`,
    );
    const pageRows = bodies.flatMap(parseBatchView);
    let added = 0;
    for (const row of pageRows) {
      if (seen.has(row.threadId)) continue;
      seen.add(row.threadId);
      rows.push(row);
      added += 1;
      if (rows.length >= limit) return rows;
    }
    if (pageNumber > 1 && added === 0) {
      throw new CommandExecutionError(`Gmail thread pagination page ${pageNumber} repeated an earlier response; refusing partial results`);
    }
    if (pageRows.length < PAGE_SIZE) break;
  }
  if (rows.length === 0) {
    throw new EmptyResultError('gmail search', `No threads matched "${normalizedQuery}"`);
  }
  return rows.slice(0, limit);
}

export async function listLabels(page, account = 0) {
  await ensureGmailReady(page, account, 'labels');
  await installGmailCapture(page, account, 'bv', 'labels');
  await submitSearch(page, 'in:anywhere', 'labels');
  const bodies = await waitGmailCaptures(page, 'bv', 'labels');
  const labels = bodies.flatMap(parseLabels);
  const fallback = labels.length === 0 ? await renderedLabels(page, account) : [];
  const unique = [...new Map([...labels, ...fallback].map((row) => [row.id, row])).values()];
  if (unique.length === 0) throw new EmptyResultError('gmail labels', 'Gmail returned no labels');
  return unique;
}

export function legacyThreadId(value) {
  const raw = cleanString(value);
  const fromUrl = raw.match(/\/(?:[a-f\d]{10,})$/i)?.[0]?.slice(1);
  if (fromUrl) return fromUrl.toLowerCase();
  if (/^[a-f\d]{10,}$/i.test(raw)) return raw.toLowerCase();
  const sync = raw.replace(/^#/, '').match(/^thread-f:(\d+)$/);
  if (sync) return BigInt(sync[1]).toString(16);
  throw new ArgumentError('thread must be a Gmail thread id from `gmail search` or a Gmail thread URL');
}

export async function fetchThread(page, target, account = 0) {
  const legacyId = legacyThreadId(target);
  await ensureGmailReady(page, account, 'thread');
  await installGmailCapture(page, account, 'fd', 'thread');
  const targetState = unwrapBrowserResult(await page.evaluate(`async () => {
    const row = document.querySelector('[data-legacy-thread-id="${legacyId}"]');
    if (!row) return { found: false };
    const clickable = row.querySelector('.y6, .bog, td:nth-child(5)') || row;
    const before = location.href;
    clickable.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const rect = clickable.getBoundingClientRect();
    return { found: true, changed: location.href !== before, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }`), 'thread row lookup');
  if (targetState?.found && !targetState.changed && typeof page.nativeClick === 'function') {
    await page.nativeClick(targetState.x, targetState.y);
  } else if (!targetState?.found) {
    const navigated = unwrapBrowserResult(await page.evaluate(`() => {
    const target = ${JSON.stringify(`#all/${legacyId}`)};
    if (window.location.hash === target) window.location.hash = '#inbox';
    setTimeout(() => { window.location.hash = target; }, 50);
    return true;
  }`), 'thread navigation');
    if (navigated !== true) throw new CommandExecutionError('Gmail thread navigation failed');
  }
  let messages = [];
  try {
    const bodies = await waitGmailCaptures(page, 'fd', 'thread', 3);
    messages = bodies.flatMap(parseFetchData);
  } catch (error) {
    if (!(error instanceof TimeoutError)) throw error;
    await page.sleep(0.5);
    messages = await renderedThread(page, target);
    if (messages.length === 0) throw error;
  }
  const unique = [...new Map(messages.map((message) => [message.messageId, message])).values()];
  if (unique.length === 0) {
    throw new EmptyResultError('gmail thread', `No messages found for thread ${target}`);
  }
  return unique;
}
