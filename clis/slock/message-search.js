// message-search.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { authHeadersFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';
import { UUID_RE, parsePositiveInteger } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'message-search',
  access: 'read',
  description: 'Search messages',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'query', positional: true, required: true, help: 'Search query' },
    { name: 'channel', help: 'Restrict to a channel (UUID or #name)' },
    { name: 'limit', type: 'int', default: 50, help: 'Max results' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['id', 'channelId', 'createdAt', 'senderName', 'content'],
  func: async (page, kwargs) => {
    const q = String(kwargs.query ?? '').trim();
    if (!q) throw new ArgumentError('query required');
    const channel = String(kwargs.channel ?? '').trim();
    const isUuid = channel ? UUID_RE.test(channel) : false;
    const target = channel ? JSON.stringify(channel.replace(/^#/, '').toLowerCase()) : '""';
    // R1 — raw override; authHeadersFragment owns the UUID-vs-slug resolution.
    const override = kwargs.server ?? null;
    const limit = parsePositiveInteger(kwargs.limit, '--limit', { defaultValue: 50 });
    await page.goto(SLOCK_HOME_URL);
    const snippet = `
      ${authHeadersFragment({ serverScoped: true, serverIdOverride: override })}
      let channelId = '';
      if (${JSON.stringify(channel)}) {
        if (${isUuid}) {
          channelId = ${JSON.stringify(channel)};
        } else {
          const cres = await fetch('${SLOCK_API_BASE}/channels/', { credentials:'include', headers });
          if (!cres.ok) return { kind: cres.status===401?'auth':'http', status: cres.status, where:'/channels/' };
          const arr = await cres.json();
          const hit = (Array.isArray(arr)?arr:(arr.channels||arr.data||[])).find((c) => (c.name||c.slug||'').toLowerCase() === ${target});
          if (!hit) return { kind: 'unresolvable', detail: 'no channel matches ' + ${JSON.stringify(channel)} };
          channelId = hit.id;
        }
      }
      const searchUrl = '${SLOCK_API_BASE}/messages/search?q=' + encodeURIComponent(${JSON.stringify(q)}) + (channelId ? '&channelId=' + encodeURIComponent(channelId) : '') + '&limit=' + encodeURIComponent(${JSON.stringify(limit)});
      const res = await fetch(searchUrl, { credentials:'include', headers });
      if (!res.ok) return { kind: res.status===401?'auth':'http', status: res.status, where:'/messages/search' };
      const data = await res.json();
      // F2-b — qatester live dump: shape is { results: [...], hasMore }.
      // Unwrap .results first; fall back to legacy .messages / .data /
      // bare array for forward-compat.
      return { kind: 'ok', rows: Array.isArray(data) ? data : (data.results || data.messages || data.data || []) };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    if (!Array.isArray(rows)) {
      throw new CommandExecutionError(`expected array of rows from server, got ${typeof rows} (contract drift?)`);
    }
    return rows.map((m) => ({
      id: m.id ?? m.messageId ?? '',
      channelId: m.channelId ?? '',
      createdAt: m.createdAt ?? m.created_at ?? '',
      senderName: m.sender?.name ?? m.user?.name ?? '',
      content: m.content ?? '',
    }));
  },
});
