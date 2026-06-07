// channel-members.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';
import { UUID_RE } from './resolve.js';

function buildChannelMembersSnippet(channelInput, override) {
  const isUuid = UUID_RE.test(channelInput);
  const target = JSON.stringify(channelInput.replace(/^#/, '').toLowerCase());
  const override_ = override ? JSON.stringify(override) : 'null';
  // The snippet always resolves server first (slug → id), then channel (uuid passthrough or name lookup),
  // then GET /channels/:id/members.
  return `
    const token = localStorage.getItem('slock_access_token');
    if (!token) return { kind: 'auth', detail: 'no access token' };
    let sid = ${override_};
    if (!sid) {
      const slug = localStorage.getItem('slock_last_server_slug');
      if (!slug) return { kind: 'no-server', detail: 'no active slug' };
      const sres = await fetch('/api/servers/', { credentials:'include', headers:{authorization:'Bearer '+token,accept:'application/json'} });
      if (sres.status === 401) return { kind: 'auth', detail: '/servers/ 401' };
      if (!sres.ok) return { kind: 'http', status: sres.status, where: '/servers/' };
      const slist = await sres.json();
      const m = slist.find((s) => s.slug === slug);
      if (!m) return { kind: 'no-server', detail: 'slug not in list' };
      sid = m.id;
    }
    const headers = { authorization:'Bearer '+token, accept:'application/json', 'x-server-id': sid };
    let channelId;
    if (${isUuid}) {
      channelId = ${JSON.stringify(channelInput)};
    } else {
      const cres = await fetch('/api/channels/', { credentials:'include', headers });
      if (cres.status === 401) return { kind: 'auth', detail: '/channels/ 401' };
      if (!cres.ok) return { kind: 'http', status: cres.status, where: '/channels/' };
      const list = await cres.json();
      const arr = Array.isArray(list) ? list : (list.channels || list.data || []);
      const hit = arr.find((c) => (c.name || c.slug || '').toLowerCase() === ${target});
      if (!hit) return { kind: 'unresolvable', detail: 'no channel matches "' + ${target} + '"' };
      channelId = hit.id;
    }
    const mres = await fetch('/api/channels/' + encodeURIComponent(channelId) + '/members', { credentials:'include', headers });
    if (mres.status === 401) return { kind: 'auth', detail: '/members 401' };
    if (!mres.ok) return { kind: 'http', status: mres.status, where: '/channels/:id/members' };
    const data = await mres.json();
    return { kind: 'ok', rows: Array.isArray(data) ? data : (data.members || data.data || []) };
  `;
}

cli({
  site: SLOCK_SITE,
  name: 'channel-members',
  access: 'read',
  description: 'List members of a channel',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'channel', positional: true, required: true, help: 'channelId UUID or #name' },
    { name: 'server', help: 'Override active server (slug or id)' },
  ],
  columns: ['userId', 'name', 'role'],
  func: async (page, kwargs) => {
    const channel = String(kwargs.channel ?? '').trim();
    if (!channel) throw new ArgumentError('channel required');
    await page.goto(SLOCK_HOME_URL);
    const snippet = buildChannelMembersSnippet(channel, kwargs.server);
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    return rows.map((m) => ({
      userId: m.userId ?? m.id ?? '',
      name: m.name ?? m.username ?? m.displayName ?? '',
      role: m.role ?? '',
    }));
  },
});
