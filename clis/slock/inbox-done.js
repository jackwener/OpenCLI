// inbox-done.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { authHeadersFragment, channelResolveFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';

cli({
  site: SLOCK_SITE,
  name: 'inbox-done',
  access: 'write',
  description: 'Mark one chat as done / clear it from the inbox (POST /channels/inbox/done)',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'channel', positional: true, required: true, help: 'channelId UUID or #name' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['channel', 'result'],
  func: async (page, kwargs) => {
    const channel = String(kwargs.channel ?? '').trim();
    if (!channel) throw new ArgumentError('channel required');
    await page.goto(SLOCK_HOME_URL);
    // channelId travels in the BODY (not the URL), so resolve then POST the fixed path.
    const snippet = `
      ${authHeadersFragment({ serverScoped: true, serverIdOverride: kwargs.server })}
      ${channelResolveFragment(channel)}
      const res = await fetch('${SLOCK_API_BASE}/channels/inbox/done', { method:'POST', credentials:'include', headers, body: JSON.stringify({ channelId }) });
      if (res.status === 401) return { kind: 'auth', detail: '/channels/inbox/done returned 401' };
      if (!res.ok) return { kind: 'http', status: res.status, where:'/channels/inbox/done' };
      const data = await res.json().catch(() => ({}));
      return { kind: 'ok', rows: data };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    dispatchEvaluateResult(result);
    return [{ channel, result: 'done' }];
  },
});
