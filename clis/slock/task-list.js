// task-list.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';
import { UUID_RE } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'task-list',
  access: 'read',
  description: 'List tasks attached to a channel',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'channel', positional: true, required: true, help: 'channelId UUID or #name' },
    { name: 'v2', type: 'bool', default: false, help: 'Use /tasks/v2 endpoint' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['id', 'title', 'status', 'dueAt'],
  func: async (page, kwargs) => {
    const channel = String(kwargs.channel ?? '').trim();
    if (!channel) throw new ArgumentError('channel required');
    const isUuid = UUID_RE.test(channel);
    const target = JSON.stringify(channel.replace(/^#/, '').toLowerCase());
    const override = kwargs.server ? JSON.stringify(kwargs.server) : 'null';
    const endpoint = kwargs.v2 ? '/api/tasks/v2/channel/' : '/api/tasks/channel/';
    await page.goto(SLOCK_HOME_URL);
    const snippet = `
      const token = localStorage.getItem('slock_access_token');
      if (!token) return { kind: 'auth', detail: 'no token' };
      let sid = ${override};
      if (!sid) {
        const slug = localStorage.getItem('slock_last_server_slug');
        if (!slug) return { kind: 'no-server', detail: 'no slug' };
        const sres = await fetch('/api/servers/', { credentials:'include', headers:{authorization:'Bearer '+token,accept:'application/json'} });
        if (!sres.ok) return { kind: sres.status===401?'auth':'http', status: sres.status, where: '/servers/', detail: 'servers fetch' };
        const slist = await sres.json();
        const m = slist.find((s) => s.slug === slug);
        if (!m) return { kind: 'no-server', detail: 'slug missing' };
        sid = m.id;
      }
      const headers = { authorization:'Bearer '+token, accept:'application/json', 'x-server-id': sid };
      let channelId;
      if (${isUuid}) {
        channelId = ${JSON.stringify(channel)};
      } else {
        const cres = await fetch('/api/channels/', { credentials:'include', headers });
        if (!cres.ok) return { kind: cres.status===401?'auth':'http', status: cres.status, where:'/channels/', detail:'list' };
        const arr = await cres.json();
        const hit = (Array.isArray(arr)?arr:(arr.channels||arr.data||[])).find((c) => (c.name||c.slug||'').toLowerCase() === ${target});
        if (!hit) return { kind: 'unresolvable', detail: 'no channel "' + ${target} + '"' };
        channelId = hit.id;
      }
      const tres = await fetch(${JSON.stringify(endpoint)} + encodeURIComponent(channelId), { credentials:'include', headers });
      if (!tres.ok) return { kind: tres.status===401?'auth':'http', status: tres.status, where: ${JSON.stringify(endpoint + ':id')}, detail: '' };
      const data = await tres.json();
      return { kind: 'ok', rows: Array.isArray(data) ? data : (data.tasks || data.data || []) };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    if (!Array.isArray(rows)) {
      throw new CommandExecutionError(`expected array of rows from server, got ${typeof rows} (contract drift?)`);
    }
    return rows.map((t) => ({
      id: t.id ?? '',
      title: t.title ?? t.name ?? '',
      status: t.status ?? '',
      dueAt: t.dueAt ?? t.due_at ?? null,
    }));
  },
});
