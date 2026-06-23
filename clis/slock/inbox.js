// inbox.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { buildFetchSnippet } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';
import { parseNonNegativeInteger, parsePositiveInteger } from './resolve.js';

const FILTERS = ['all', 'unread', 'mentions'];

// InboxItem is a union: channel/dm items vs thread items. Flatten both into a
// uniform row so the table is stable regardless of kind.
function mapItem(it) {
  if (it.kind === 'thread') {
    return {
      kind: 'thread',
      id: it.threadChannelId ?? '',
      name: it.parentChannelName ?? '',
      unreadCount: typeof it.unreadCount === 'number' ? it.unreadCount : 0,
      hasMention: !!it.hasMention,
      lastActivityAt: it.lastActivityAt ?? it.lastReplyAt ?? '',
      preview: it.latestActivityPreview ?? it.parentMessagePreview ?? '',
    };
  }
  return {
    kind: it.kind ?? 'channel',
    id: it.channelId ?? '',
    name: it.channelName ?? '',
    unreadCount: typeof it.unreadCount === 'number' ? it.unreadCount : 0,
    hasMention: !!it.hasMention,
    lastActivityAt: it.lastMessageAt ?? '',
    preview: it.lastMessagePreview ?? '',
  };
}

cli({
  site: SLOCK_SITE,
  name: 'inbox',
  access: 'read',
  description: 'List unified inbox items (channels, DMs, followed threads) that need attention.',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'filter', default: 'all', help: 'all | unread | mentions' },
    { name: 'limit', type: 'int', default: 30, help: 'Max items (server caps at 100)' },
    { name: 'offset', type: 'int', default: 0, help: 'Pagination offset' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['kind', 'id', 'name', 'unreadCount', 'hasMention', 'lastActivityAt', 'preview'],
  func: async (page, kwargs) => {
    const filter = String(kwargs.filter ?? 'all').toLowerCase();
    if (!FILTERS.includes(filter)) {
      throw new ArgumentError(`--filter must be one of ${FILTERS.join(' | ')} (got "${filter}")`);
    }
    const limit = parsePositiveInteger(kwargs.limit, '--limit', { defaultValue: 30, max: 100 });
    const offset = parseNonNegativeInteger(kwargs.offset, '--offset', { defaultValue: 0 });
    await page.goto(SLOCK_HOME_URL);
    const snippet = buildFetchSnippet({
      method: 'GET',
      path: `/channels/inbox?filter=${encodeURIComponent(filter)}&limit=${limit}&offset=${offset}`,
      serverScoped: true,
      serverIdOverride: kwargs.server,
    });
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const data = dispatchEvaluateResult(result);
    const items = Array.isArray(data) ? data : (data.items || []);
    if (!Array.isArray(items)) {
      throw new CommandExecutionError(`expected inbox items array, got ${typeof items} (contract drift?)`);
    }
    return items.map(mapItem);
  },
});
