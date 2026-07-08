// bookmark-remove.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { authHeadersFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';
import { assertMessageIdShape } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'bookmark-remove',
  access: 'write',
  description: 'Remove a bookmark (DELETE /channels/saved/:messageId). 404 is treated as already-removed.',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'messageId', positional: true, required: true, help: 'Full messageId UUID' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['messageId', 'removed', 'note'],
  func: async (page, kwargs) => {
    let id;
    try { id = assertMessageIdShape(String(kwargs.messageId ?? '')); }
    catch (e) { throw new ArgumentError(e.message); }
    await page.goto(SLOCK_HOME_URL);
    const snippet = `
      ${authHeadersFragment({ serverScoped: true, serverIdOverride: kwargs.server })}
      const res = await fetch('${SLOCK_API_BASE}/channels/saved/' + encodeURIComponent(${JSON.stringify(id)}), { method:'DELETE', credentials:'include', headers });
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
