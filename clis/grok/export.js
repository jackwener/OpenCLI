import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';
import { normalizeConversationRows, requireObjectEvaluateResult } from './export-utils.js';

const GROK_DOMAIN = 'grok.com';
const GROK_URL = 'https://grok.com/';

function normalizeLimit(value) {
  const raw = value ?? 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new ArgumentError('limit', 'must be 0 or a positive integer');
  }
  return n;
}

function normalizeMaxScrolls(value) {
  const raw = value ?? 80;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ArgumentError('maxScrolls', 'must be a positive integer');
  }
  if (n > 500) {
    throw new ArgumentError('maxScrolls', 'must be <= 500');
  }
  return n;
}

export const grokExportCommand = cli({
  site: 'grok',
  name: 'export',
  description: 'Export all visible Grok conversation history metadata',
  access: 'read',
  example: 'opencli grok export -f yaml',
  domain: GROK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: false,
  args: [
    { name: 'limit', type: 'int', default: 0, help: 'Max conversations to export; 0 means all loaded history' },
    { name: 'maxScrolls', type: 'int', default: 80, help: 'Max history-list scroll rounds when limit is 0 (max 500)' },
  ],
  columns: ['index', 'id', 'title', 'date', 'url'],
  func: async (page, kwargs) => {
    const limit = normalizeLimit(kwargs.limit);
    const maxScrolls = normalizeMaxScrolls(kwargs.maxScrolls);

    await page.goto(GROK_URL);
    await page.wait(2);

    const rawResult = await page.evaluate(`(async () => {
      const targetLimit = ${JSON.stringify(limit)};
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

      const findScroller = () => {
        const nodes = Array.from(listbox.querySelectorAll('*'));
        return nodes.find((node) => node.scrollHeight > node.clientHeight + 20) || listbox;
      };
      const scroller = findScroller();
      const seen = new Map();
      const collect = () => {
        const anchors = Array.from(listbox.querySelectorAll('a[href^="/c/"]'));
        for (const a of anchors) {
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
      let stableRounds = 0;
      let lastScrollHeight = -1;
      const stableTarget = targetLimit > 0 ? 5 : 8;
      const settleMs = targetLimit > 0 ? 300 : 350;
      const maxAttempts = targetLimit > 0 ? maxScrolls : Math.min(maxScrolls, 500);
      for (let attempt = 0; attempt < maxAttempts && stableRounds < stableTarget; attempt += 1) {
        collect();
        if (targetLimit > 0 && seen.size >= targetLimit) break;
        scroller.scrollTop = scroller.scrollHeight;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await sleep(settleMs);
        collect();
        if (targetLimit > 0 && seen.size >= targetLimit) break;
        const count = seen.size;
        const height = scroller.scrollHeight;
        if (count === lastCount && height === lastScrollHeight) {
          stableRounds += 1;
        } else {
          stableRounds = 0;
          lastCount = count;
          lastScrollHeight = height;
        }
      }

      return {
        ok: true,
        rows: Array.from(seen.values()),
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
      };
    })()`);

    const result = requireObjectEvaluateResult(rawResult, 'grok export history dialog');
    if (result.ok !== true) {
      if (result?.code === 'AUTH') {
        throw new AuthRequiredError(GROK_DOMAIN, 'Sign in to grok.com in the browser, then retry.');
      }
      if (result?.code === 'NO_DIALOG') {
        throw new TimeoutError('grok export history dialog', 8);
      }
      throw new EmptyResultError('grok export', 'No Grok conversation history was visible.');
    }

    const validRows = normalizeConversationRows(result.rows, 'grok export history dialog');
    if (!validRows.length) {
      throw new EmptyResultError('grok export', 'No Grok conversations found in the signed-in account history.');
    }

    const slicedRows = limit ? validRows.slice(0, limit) : validRows;
    return slicedRows.map((row, i) => ({
      index: i + 1,
      id: row.id,
      title: row.title || null,
      date: row.date || null,
      url: row.url,
    }));
  },
});

export const __test__ = {
  normalizeLimit,
  normalizeMaxScrolls,
};
