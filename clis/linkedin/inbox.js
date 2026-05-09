import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

const LINKEDIN_DOMAIN = 'www.linkedin.com';

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function canonicalizeLinkedInUrl(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) return '';
  try {
    const url = new URL(raw, 'https://www.linkedin.com');
    if (!/linkedin\.com$/i.test(url.hostname) && !/\.linkedin\.com$/i.test(url.hostname)) return raw;
    url.hash = '';
    url.search = '';
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.toString();
  } catch {
    return raw;
  }
}

function requireLimitArg(value) {
  const number = Number(value ?? 40);
  if (!Number.isFinite(number) || number < 1 || number > 100) {
    throw new ArgumentError('--limit must be a number between 1 and 100');
  }
  return Math.floor(number);
}

function buildInboxScript(limit) {
  const maxRows = limit;
  return String.raw`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    const bodyText = document.body ? (document.body.innerText || '') : '';
    const authRequired = /\b(sign in|log in|join linkedin)\b/i.test(bodyText)
      || /linkedin\.com\/(login|checkpoint|authwall)/i.test(location.href)
      || /captcha|verification required/i.test(bodyText);

    const pickHref = (root, pattern) => {
      const links = Array.from(root.querySelectorAll('a[href]'));
      const found = links.find((a) => pattern.test(a.href || a.getAttribute('href') || ''));
      return found ? found.href : '';
    };

    const isUnreadCard = (root, text) => {
      const aria = clean(root.getAttribute('aria-label'));
      const className = String(root.className || '');
      if (/unread/i.test(aria) || /unread/i.test(className)) return true;
      if (root.querySelector('[class*="unread"], [aria-label*="unread" i]')) return true;
      if (root.querySelector('.notification-badge, .msg-conversation-card__unread-count, [data-test-icon="unread-small"]')) return true;
      const badges = Array.from(root.querySelectorAll('span, div')).map((el) => clean(el.innerText || el.textContent)).filter(Boolean);
      return badges.some((v) => /^\d+$/.test(v) && text.includes(v));
    };

    const parseCount = (root) => {
      const candidates = Array.from(root.querySelectorAll('[class*="unread"], .notification-badge, span, div'))
        .map((el) => clean(el.innerText || el.textContent))
        .filter(Boolean);
      const hit = candidates.find((v) => /^\d+$/.test(v));
      return hit ? Number(hit) : 0;
    };

    const extractName = (root, lines) => {
      const selectors = [
        '.msg-conversation-card__participant-names',
        '.msg-conversation-card__participant-names span[aria-hidden="true"]',
        '[data-anonymize="person-name"]',
        'h3',
        'a[href*="/in/"] span[aria-hidden="true"]',
        'a[href*="/in/"]'
      ];
      for (const selector of selectors) {
        const el = root.querySelector(selector);
        const value = clean(el?.innerText || el?.textContent || el?.getAttribute?.('aria-label'));
        if (value && value.length <= 120 && !/^(message|messaging|search messages)$/i.test(value)) return value;
      }
      return lines.find((line) => line.length <= 120 && !/^\d{1,2}:\d{2}|^(mon|tue|wed|thu|fri|sat|sun)$/i.test(line)) || '';
    };

    const extractTime = (lines) => {
      return lines.find((line) => /^(\d{1,2}:\d{2}\s*(am|pm)?|mon|tue|wed|thu|fri|sat|sun|yesterday|today|\d+d|\d+w)$/i.test(line)) || '';
    };

    const cardSelectors = [
      '.msg-conversation-listitem',
      '.msg-conversation-card',
      'li:has(a[href*="/messaging/thread/"])',
      'div:has(a[href*="/messaging/thread/"])'
    ];
    let cards = [];
    for (const selector of cardSelectors) {
      try {
        cards = Array.from(document.querySelectorAll(selector));
        if (cards.length) break;
      } catch {}
    }

    const seen = new Set();
    const rows = [];
    for (const card of cards) {
      const rowText = clean(card.innerText || card.textContent);
      if (!rowText || rowText.length < 2) continue;
      const threadUrl = pickHref(card, /\/messaging\/thread\//i);
      const profileUrl = pickHref(card, /\/in\//i);
      const key = threadUrl || rowText.slice(0, 180);
      if (seen.has(key)) continue;
      seen.add(key);
      const lines = rowText.split(/\n+/).map(clean).filter(Boolean);
      const name = extractName(card, lines);
      const timestamp = extractTime(lines);
      const preview = lines.filter((line) => line !== name && line !== timestamp && !/^\d+$/.test(line)).slice(-2).join(' ');
      const unreadCount = parseCount(card);
      rows.push({
        index: rows.length,
        name,
        threadUrl,
        profileUrl,
        timestamp,
        preview,
        unread: isUnreadCard(card, rowText) || unreadCount > 0,
        unreadCount,
        rowText,
      });
      if (rows.length >= ${maxRows}) break;
    }

    await sleep(250);
    return {
      url: location.href,
      title: document.title || '',
      authRequired,
      extractedAt: new Date().toISOString(),
      rowCount: rows.length,
      rows,
    };
  })()`;
}

cli({
  site: 'linkedin',
  name: 'inbox',
  access: 'read',
  description: 'Read visible LinkedIn messaging inbox rows with thread URLs, previews, and unread hints',
  domain: LINKEDIN_DOMAIN,
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'limit', type: 'number', default: 40, help: 'Maximum visible inbox rows to return' },
    { name: 'json', type: 'bool', default: false, help: 'Return compact JSON in inbox_json' },
  ],
  columns: [
    'index',
    'name',
    'unread',
    'unread_count',
    'unreadCount',
    'timestamp',
    'preview',
    'thread_url',
    'threadUrl',
    'profile_url',
    'profileUrl',
    'rowText',
    'inbox_json',
  ],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for linkedin inbox');
    const limit = requireLimitArg(args.limit);
    await page.goto('https://www.linkedin.com/messaging/');
    await page.wait(8);
    const snapshot = await page.evaluate(buildInboxScript(limit));
    if (snapshot?.authRequired) {
      throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn inbox requires an active signed-in LinkedIn browser session.');
    }
    const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
    if (args.json) {
      return [{
        index: 0,
        name: '',
        unread: rows.some((row) => row.unread),
        unread_count: rows.reduce((sum, row) => sum + (Number(row.unreadCount) || (row.unread ? 1 : 0)), 0),
        timestamp: '',
        preview: '',
        thread_url: '',
        profile_url: '',
        inbox_json: JSON.stringify({
          ...(snapshot || {}),
          rows: rows.map((row) => ({
            ...row,
            threadUrl: canonicalizeLinkedInUrl(row.threadUrl),
            profileUrl: canonicalizeLinkedInUrl(row.profileUrl),
          })),
        }),
      }];
    }
    return rows.map((row, index) => ({
      index,
      name: normalizeWhitespace(row.name),
      unread: Boolean(row.unread),
      unread_count: Number(row.unreadCount) || 0,
      timestamp: normalizeWhitespace(row.timestamp),
      preview: normalizeWhitespace(row.preview),
      thread_url: canonicalizeLinkedInUrl(row.threadUrl),
      profile_url: canonicalizeLinkedInUrl(row.profileUrl),
      inbox_json: '',
    }));
  },
});

export const __test__ = {
  normalizeWhitespace,
  canonicalizeLinkedInUrl,
  requireLimitArg,
  buildInboxScript,
};
