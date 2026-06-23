// bookmark-add.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { authHeadersFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';
import { assertMessageIdShape } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'bookmark-add',
  access: 'write',
  description: 'Bookmark a message (POST /channels/saved). Requires full messageId UUID.',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'messageId', positional: true, required: true, help: 'Full messageId UUID (short ids rejected)' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['messageId', 'saved'],
  func: async (page, kwargs) => {
    let id;
    try { id = assertMessageIdShape(String(kwargs.messageId ?? '')); }
    catch (e) { throw new ArgumentError(e.message); }
    await page.goto(SLOCK_HOME_URL);
    const snippet = `
      ${authHeadersFragment({ serverScoped: true, serverIdOverride: kwargs.server })}
      const res = await fetch('${SLOCK_API_BASE}/channels/saved', { method:'POST', credentials:'include', headers, body: JSON.stringify({ messageId: ${JSON.stringify(id)} }) });
      if (!res.ok) return { kind: res.status===401?'auth':'http', status: res.status, where:'/channels/saved' };
      const data = await res.json().catch(() => ({}));
      // F3-a — qatester live dump: response is { ok: true } with NO id field.
      // The bookmark is keyed by messageId on the server side, so there is no
      // separate bookmark id to surface; we report saved=true and echo the
      // message id back.
      return { kind: 'ok', rows: [{ saved: data && data.ok === true, messageId: ${JSON.stringify(id)} }] };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    return rows.map((b) => ({ messageId: b.messageId ?? id, saved: b.saved === true }));
  },
});
