// bookmark-remove.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';
import { assertMessageIdShape } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'bookmark-remove',
  access: 'write',
  description: 'Remove a bookmark (DELETE /channels/saved/:messageId). 404 is treated as already-removed.',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'messageId', positional: true, required: true, help: 'Full messageId UUID' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['messageId', 'removed', 'note'],
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
      const headers = { authorization:'Bearer '+token, accept:'application/json', 'x-server-id': sid };
      const res = await fetch('/api/channels/saved/' + encodeURIComponent(${JSON.stringify(id)}), { method:'DELETE', credentials:'include', headers });
      if (res.status === 404) return { kind: 'http', status: 404, where:'/channels/saved/:id' };
      if (!res.ok) return { kind: res.status===401?'auth':'http', status: res.status, where:'/channels/saved/:id' };
      return { kind: 'ok', rows: [{ removed: true }] };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    if (result && result.kind === 'http' && result.status === 404) {
      return [{ messageId: id, removed: true, note: 'idempotent (already absent)' }];
    }
    const rows = dispatchEvaluateResult(result);
    return rows.map(() => ({ messageId: id, removed: true, note: '' }));
  },
});
