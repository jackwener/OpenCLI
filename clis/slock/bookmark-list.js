// bookmark-list.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';

cli({
  site: SLOCK_SITE,
  name: 'bookmark-list',
  access: 'read',
  description: 'List bookmarks (saved messages) in the active server',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 50, help: 'Max results' },
    { name: 'offset', type: 'int', default: 0, help: 'Offset' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['id', 'messageId', 'content', 'savedAt'],
  func: async (page, kwargs) => {
    const limit = String(kwargs.limit ?? 50);
    const offset = String(kwargs.offset ?? 0);
    const override = kwargs.server ? JSON.stringify(kwargs.server) : 'null';
    await page.goto(SLOCK_HOME_URL);
    const snippet = `
      const token = localStorage.getItem('slock_access_token');
      if (!token) return { kind: 'auth', detail: 'no token' };
      let sid = ${override};
      if (!sid) {
        const slug = localStorage.getItem('slock_last_server_slug');
        if (!slug) return { kind: 'no-server', detail: 'no slug' };
        const sres = await fetch('/api/servers/', { credentials:'include', headers:{authorization:'Bearer '+token,accept:'application/json'} });
        if (!sres.ok) return { kind: sres.status===401?'auth':'http', status: sres.status, where:'/servers/' };
        const slist = await sres.json();
        const sm = slist.find((s) => s.slug === slug);
        if (!sm) return { kind: 'no-server', detail: 'slug missing' };
        sid = sm.id;
      }
      const headers = { authorization:'Bearer '+token, accept:'application/json', 'x-server-id': sid };
      const res = await fetch('/api/channels/saved?limit=${limit}&offset=${offset}', { credentials:'include', headers });
      if (!res.ok) return { kind: res.status===401?'auth':'http', status: res.status, where:'/channels/saved' };
      const data = await res.json();
      return { kind: 'ok', rows: Array.isArray(data) ? data : (data.bookmarks || data.data || []) };
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
