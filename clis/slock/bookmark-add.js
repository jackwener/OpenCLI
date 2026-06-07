// bookmark-add.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';
import { assertMessageIdShape } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'bookmark-add',
  access: 'write',
  description: 'Bookmark a message (POST /channels/saved). Requires full messageId UUID.',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'messageId', positional: true, required: true, help: 'Full messageId UUID (short ids rejected)' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['messageId', 'bookmarkId'],
  func: async (page, kwargs) => {
    let id;
    try { id = assertMessageIdShape(String(kwargs.messageId ?? '')); }
    catch (e) { throw new ArgumentError(e.message); }
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
      const headers = { authorization:'Bearer '+token, accept:'application/json', 'content-type':'application/json', 'x-server-id': sid };
      const res = await fetch('/api/channels/saved', { method:'POST', credentials:'include', headers, body: JSON.stringify({ messageId: ${JSON.stringify(id)} }) });
      if (!res.ok) return { kind: res.status===401?'auth':'http', status: res.status, where:'/channels/saved' };
      const data = await res.json();
      return { kind: 'ok', rows: [{ id: data.id ?? data.bookmarkId ?? null, messageId: ${JSON.stringify(id)} }] };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    return rows.map((b) => ({ messageId: b.messageId ?? id, bookmarkId: b.id ?? null }));
  },
});
