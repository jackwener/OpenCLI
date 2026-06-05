import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';
import fs from 'node:fs';
import {
  normalizeConversationRows,
  normalizeManifestRows,
  requireBooleanEvaluateResult,
  requireObjectEvaluateResult,
} from './export-utils.js';

const GROK_DOMAIN = 'grok.com';
const GROK_URL = 'https://grok.com/';

function normalizeInteger(value, defaultValue, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = value ?? defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new ArgumentError(label, `must be an integer`);
  }
  if (n < min) {
    throw new ArgumentError(label, `must be >= ${min}`);
  }
  if (n > max) {
    throw new ArgumentError(label, `must be <= ${max}`);
  }
  return n;
}

async function waitRandom(page, minMs, maxMs) {
  if (maxMs <= 0) return;
  const span = Math.max(0, maxMs - minMs);
  const ms = minMs + Math.floor(Math.random() * (span + 1));
  if (ms > 0) await page.wait(ms / 1000);
}

function readManifest(manifestPath, { offset, limit }) {
  const path = String(manifestPath || '').trim();
  if (!path) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ArgumentError('manifestPath', `failed to read JSON manifest: ${error?.message || error}`);
  }
  const rows = normalizeManifestRows(parsed);
  const sliced = limit ? rows.slice(offset, offset + limit) : rows.slice(offset);
  if (!sliced.length) {
    throw new EmptyResultError('grok export-all', `No manifest rows after offset=${offset}, limit=${limit}`);
  }
  return sliced;
}

async function collectHistory(page, { offset, limit, maxScrolls }) {
  await page.goto(GROK_URL);
  await page.wait(2);
  const rawResult = await page.evaluate(`(async () => {
    const targetLimit = ${JSON.stringify(limit > 0 ? offset + limit : 0)};
    const maxScrolls = ${JSON.stringify(maxScrolls)};
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const isVisible = (node) => {
      if (!(node instanceof Element)) return false;
      const style = window.getComputedStyle(node);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const hasHistoryEntry = Boolean(document.querySelector('a[href^="/c/"]'));
    const hasHistoryLauncher = Array.from(document.querySelectorAll('button, [role="button"]'))
      .some((node) => isVisible(node) && /^(查看全部|show all|view all)$/i.test((node.textContent || '').trim()));
    const signInCta = Array.from(document.querySelectorAll('button, a'))
      .some((node) => isVisible(node) && /^(sign in|log in)$/i.test((node.textContent || '').trim()));
    if (signInCta && !hasHistoryEntry && !hasHistoryLauncher) {
      return { ok: false, code: 'AUTH' };
    }

    const clickAllHistory = () => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter((node) => node instanceof HTMLElement && isVisible(node));
      const target = buttons.find((node) => /^(查看全部|show all|view all)$/i.test((node.textContent || '').trim()));
      if (!target) return false;
      target.click();
      return true;
    };

    if (!document.querySelector('[role="listbox"] a[href^="/c/"]')) {
      clickAllHistory();
    }

    let listbox = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      listbox = document.querySelector('[role="listbox"]');
      if (listbox && listbox.querySelector('a[href^="/c/"]')) break;
      await sleep(250);
    }
    if (!listbox || !listbox.querySelector('a[href^="/c/"]')) {
      return { ok: false, code: 'NO_DIALOG' };
    }

    const scroller = Array.from(listbox.querySelectorAll('*'))
      .find((node) => node.scrollHeight > node.clientHeight + 20) || listbox;
    const seen = new Map();
    const collect = () => {
      for (const a of Array.from(listbox.querySelectorAll('a[href^="/c/"]'))) {
        const href = a.getAttribute('href') || '';
        const match = href.match(/^\\/c\\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
        if (!match) continue;
        const id = match[1].toLowerCase();
        const option = a.closest('[role="option"]') || a.parentElement;
        const lines = (option?.innerText || option?.textContent || a.textContent || '')
          .split(/\\n+/)
          .map((line) => line.trim())
          .filter(Boolean);
        seen.set(id, {
          id,
          title: lines[0] || '',
          date: lines.slice(1).find(Boolean) || '',
          url: 'https://grok.com/c/' + id,
        });
      }
    };

    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    await sleep(250);

    let lastCount = -1;
    let lastHeight = -1;
    let stableRounds = 0;
    for (let attempt = 0; attempt < maxScrolls; attempt += 1) {
      collect();
      if (targetLimit > 0 && seen.size >= targetLimit) break;
      scroller.scrollTop = scroller.scrollHeight;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(350);
      collect();
      if (targetLimit > 0 && seen.size >= targetLimit) break;
      if (seen.size === lastCount && scroller.scrollHeight === lastHeight) {
        stableRounds += 1;
      } else {
        stableRounds = 0;
        lastCount = seen.size;
        lastHeight = scroller.scrollHeight;
      }
      if (targetLimit === 0 && stableRounds >= 8) break;
    }

    return { ok: true, rows: Array.from(seen.values()) };
  })()`);

  const result = requireObjectEvaluateResult(rawResult, 'grok export-all history dialog');
  if (result.ok !== true) {
    if (result?.code === 'AUTH') {
      throw new AuthRequiredError(GROK_DOMAIN, 'Sign in to grok.com in the browser, then retry.');
    }
    if (result?.code === 'NO_DIALOG') {
      throw new TimeoutError('grok export-all history dialog', 8);
    }
    throw new EmptyResultError('grok export-all', 'No Grok conversation history was visible.');
  }
  const validRows = normalizeConversationRows(result.rows, 'grok export-all history dialog');
  if (!validRows.length) {
    throw new EmptyResultError('grok export-all', 'No Grok conversations found in the signed-in account history.');
  }
  return limit ? validRows.slice(offset, offset + limit) : validRows.slice(offset);
}

async function readConversation(page, conversation, { pageTimeoutMs, pageScrolls, delayMinMs, delayMaxMs }) {
  await page.goto(conversation.url);
  const startedAt = Date.now();
  let loaded = false;

  while (Date.now() - startedAt < pageTimeoutMs) {
    let loadedPayload;
    try {
      loadedPayload = await page.evaluate(`(() => {
        return Boolean(document.querySelector('[data-testid="user-message"], [data-testid="assistant-message"]'));
      })()`);
      loaded = requireBooleanEvaluateResult(loadedPayload, 'grok export-all page load check');
    } catch (error) {
      return {
        status: 'failed',
        error: `Page load check failed: ${error?.message || error}`,
        messageCount: 0,
        messagesJson: '[]',
      };
    }
    if (loaded) break;
    await page.wait(1);
  }
  if (!loaded) {
    return {
      status: 'empty',
      error: 'No visible message bubbles after waiting for page load.',
      messageCount: 0,
      messagesJson: '[]',
    };
  }

  await waitRandom(page, delayMinMs, delayMaxMs);

  let rawResult;
  let result;
  try {
    rawResult = await page.evaluate(`(async () => {
      const maxScrolls = ${JSON.stringify(pageScrolls)};
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const isVisible = (node) => {
        if (!(node instanceof Element)) return false;
        const style = window.getComputedStyle(node);
        if (style.visibility === 'hidden' || style.display === 'none') return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const messageSelector = '[data-testid="user-message"], [data-testid="assistant-message"]';
      const findScrollableAncestors = () => {
        const first = document.querySelector(messageSelector);
        const out = [document.scrollingElement || document.documentElement];
        let node = first ? first.parentElement : null;
        while (node && node !== document.body) {
          if (node.scrollHeight > node.clientHeight + 20) out.push(node);
          node = node.parentElement;
        }
        return Array.from(new Set(out));
      };
      const scrollables = findScrollableAncestors();
      const countMessages = () => Array.from(document.querySelectorAll(messageSelector)).filter(isVisible).length;

      let lastCount = -1;
      let lastBottom = -1;
      let stableRounds = 0;
      for (let attempt = 0; attempt < maxScrolls && stableRounds < 5; attempt += 1) {
        for (const scroller of scrollables) {
          scroller.scrollTop = scroller.scrollHeight;
          scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
        window.scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight);
        await sleep(300);
        const count = countMessages();
        const bottom = Math.max(
          document.documentElement.scrollHeight || 0,
          document.body.scrollHeight || 0,
          ...scrollables.map((node) => node.scrollHeight || 0),
        );
        if (count === lastCount && bottom === lastBottom) {
          stableRounds += 1;
        } else {
          stableRounds = 0;
          lastCount = count;
          lastBottom = bottom;
        }
      }

      const findResponseId = (node) => {
        let parent = node.parentElement;
        while (parent && parent !== document.body) {
          const id = parent.getAttribute('id') || '';
          if (id.startsWith('response-')) return id.slice('response-'.length);
          parent = parent.parentElement;
        }
        return '';
      };
      const messages = [];
      let position = 0;
      for (const node of Array.from(document.querySelectorAll(messageSelector))) {
        if (!(node instanceof HTMLElement) || !isVisible(node)) continue;
        const isAssistant = node.getAttribute('data-testid') === 'assistant-message';
        const text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
        const html = node.innerHTML || '';
        if (!text && !html) continue;
        messages.push({
          messageIndex: messages.length + 1,
          messageId: findResponseId(node) || ('pos-' + position),
          messageRole: isAssistant ? 'assistant' : 'user',
          messageText: text,
        });
        position += 1;
      }
      return { messages };
    })()`);
    result = requireObjectEvaluateResult(rawResult, 'grok export-all conversation reader');
  } catch (error) {
    return {
      status: 'failed',
      error: `Conversation reader failed: ${error?.message || error}`,
      messageCount: 0,
      messagesJson: '[]',
    };
  }
  if (!Array.isArray(result.messages)) {
    return {
      status: 'failed',
      error: 'Conversation reader returned malformed message rows.',
      messageCount: 0,
      messagesJson: '[]',
    };
  }
  const messages = [];
  for (let index = 0; index < result.messages.length; index += 1) {
    const message = result.messages[index];
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return {
        status: 'failed',
        error: `Conversation reader returned malformed message row ${index + 1}.`,
        messageCount: 0,
        messagesJson: '[]',
      };
    }
    const messageId = String(message.messageId || '').trim();
    const messageText = String(message.messageText || '').trim();
    if (!messageId || !messageText || (message.messageRole !== 'assistant' && message.messageRole !== 'user')) {
      return {
        status: 'failed',
        error: `Conversation reader returned malformed message row ${index + 1}.`,
        messageCount: 0,
        messagesJson: '[]',
      };
    }
    messages.push({
      messageIndex: Number.isInteger(message.messageIndex) ? message.messageIndex : index + 1,
      messageId,
      messageRole: message.messageRole,
      messageText,
    });
  }
  if (!messages.length) {
    return {
      status: 'empty',
      error: 'Page loaded, but no visible message text was found after scrolling to bottom.',
      messageCount: 0,
      messagesJson: '[]',
    };
  }
  return {
    status: 'ok',
    error: null,
    messageCount: messages.length,
    messagesJson: JSON.stringify(messages),
  };
}

export const grokExportAllCommand = cli({
  site: 'grok',
  name: 'export-all',
  description: 'Export Grok conversation history and each conversation transcript',
  access: 'read',
  example: 'opencli grok export-all --limit 5 -f json',
  domain: GROK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: false,
  args: [
    { name: 'limit', type: 'int', default: 0, help: 'Max conversations to export; 0 means all loaded history' },
    { name: 'offset', type: 'int', default: 0, help: 'Skip this many conversations before exporting' },
    { name: 'manifestPath', type: 'string', default: '', help: 'Optional grok/export JSON manifest path; skips history dialog and visits listed /c pages directly' },
    { name: 'maxScrolls', type: 'int', default: 80, help: 'Max history-list scroll rounds when limit is 0 (max 500)' },
    { name: 'pageScrolls', type: 'int', default: 30, help: 'Max per-conversation scroll-to-bottom rounds (max 200)' },
    { name: 'pageTimeoutMs', type: 'int', default: 30000, help: 'Max wait for each conversation page to show messages' },
    { name: 'delayMinMs', type: 'int', default: 0, help: 'Minimum polite delay after a conversation page loads' },
    { name: 'delayMaxMs', type: 'int', default: 5000, help: 'Maximum polite delay after a conversation page loads' },
  ],
  columns: ['index', 'id', 'title', 'date', 'url', 'status', 'messageCount', 'error', 'messagesJson'],
  func: async (page, kwargs) => {
    const limit = normalizeInteger(kwargs.limit, 0, 'limit', { min: 0 });
    const offset = normalizeInteger(kwargs.offset, 0, 'offset', { min: 0 });
    const maxScrolls = normalizeInteger(kwargs.maxScrolls, 80, 'maxScrolls', { min: 1, max: 500 });
    const pageScrolls = normalizeInteger(kwargs.pageScrolls, 30, 'pageScrolls', { min: 1, max: 200 });
    const pageTimeoutMs = normalizeInteger(kwargs.pageTimeoutMs, 30000, 'pageTimeoutMs', { min: 5000, max: 180000 });
    const delayMinMs = normalizeInteger(kwargs.delayMinMs, 0, 'delayMinMs', { min: 0, max: 60000 });
    const delayMaxMs = normalizeInteger(kwargs.delayMaxMs, 5000, 'delayMaxMs', { min: 0, max: 60000 });
    if (delayMaxMs < delayMinMs) {
      throw new ArgumentError('delayMaxMs', 'must be >= delayMinMs');
    }

    const conversations = readManifest(kwargs.manifestPath, { offset, limit })
      || await collectHistory(page, { offset, limit, maxScrolls });
    const rows = [];
    for (let i = 0; i < conversations.length; i += 1) {
      const conversation = conversations[i];
      const transcript = await readConversation(page, conversation, {
        pageTimeoutMs,
        pageScrolls,
        delayMinMs,
        delayMaxMs,
      });
      rows.push({
        index: offset + i + 1,
        id: conversation.id,
        title: conversation.title || null,
        date: conversation.date || null,
        url: conversation.url,
        status: transcript.status,
        messageCount: transcript.messageCount,
        error: transcript.error,
        messagesJson: transcript.messagesJson,
      });
    }

    if (!rows.length) {
      throw new EmptyResultError('grok export-all', 'No Grok conversations were exported.');
    }
    return rows;
  },
});

export const __test__ = {
  normalizeInteger,
  readManifest,
};
