// bookmark-list.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { authHeadersFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';
import { parseNonNegativeInteger, parsePositiveInteger } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'bookmark-list',
  access: 'read',
  description: 'List bookmarks (saved messages) in the active server',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'limit', type: 'int', default: 50, help: 'Max results' },
    { name: 'offset', type: 'int', default: 0, help: 'Offset' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['id', 'messageId', 'content', 'savedAt'],
  func: async (page, kwargs) => {
    const limit = parsePositiveInteger(kwargs.limit, '--limit', { defaultValue: 50 });
    const offset = parseNonNegativeInteger(kwargs.offset, '--offset', { defaultValue: 0 });
    await page.goto(SLOCK_HOME_URL);
    const snippet = `
      ${authHeadersFragment({ serverScoped: true, serverIdOverride: kwargs.server })}
      const res = await fetch('${SLOCK_API_BASE}/channels/saved?limit=' + encodeURIComponent(${JSON.stringify(limit)}) + '&offset=' + encodeURIComponent(${JSON.stringify(offset)}), { credentials:'include', headers });
      if (!res.ok) return { kind: res.status===401?'auth':'http', status: res.status, where:'/channels/saved' };
      const data = await res.json();
      // F3-b — qatester live dump: shape is { saved: [...], hasMore }.
      // Unwrap .saved first; fall back to legacy .bookmarks / .data /
      // bare array for forward-compat.
      return { kind: 'ok', rows: Array.isArray(data) ? data : (data.saved || data.bookmarks || data.data || []) };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    if (!Array.isArray(rows)) {
      throw new CommandExecutionError(`expected array of rows from server, got ${typeof rows} (contract drift?)`);
    }
    return rows.map((b) => ({
      id: b.id ?? '',
      messageId: b.messageId ?? '',
      content: b.content ?? b.message?.content ?? '',
      savedAt: b.savedAt ?? b.createdAt ?? '',
    }));
  },
});
