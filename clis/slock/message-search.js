// message-search.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';
import { UUID_RE } from './resolve.js';

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
    const override = kwargs.server ? JSON.stringify(kwargs.server) : 'null';
    const limit = String(kwargs.limit ?? 50);
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
      let channelId = '';
      if (${JSON.stringify(channel)}) {
        if (${isUuid}) {
          channelId = ${JSON.stringify(channel)};
        } else {
          const cres = await fetch('/api/channels/', { credentials:'include', headers });
          if (!cres.ok) return { kind: cres.status===401?'auth':'http', status: cres.status, where:'/channels/' };
          const arr = await cres.json();
          const hit = (Array.isArray(arr)?arr:(arr.channels||arr.data||[])).find((c) => (c.name||c.slug||'').toLowerCase() === ${target});
          if (!hit) return { kind: 'unresolvable', detail: 'no channel matches ${channel}' };
          channelId = hit.id;
        }
      }
      const searchUrl = '/api/messages/search?q=' + encodeURIComponent(${JSON.stringify(q)}) + (channelId ? '&channelId=' + encodeURIComponent(channelId) : '') + '&limit=' + encodeURIComponent(${JSON.stringify(limit)});
      const res = await fetch(searchUrl, { credentials:'include', headers });
      if (!res.ok) return { kind: res.status===401?'auth':'http', status: res.status, where:'/messages/search' };
      const data = await res.json();
      return { kind: 'ok', rows: Array.isArray(data) ? data : (data.messages || data.data || []) };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    return rows.map((m) => ({
      id: m.id ?? m.messageId ?? '',
      channelId: m.channelId ?? '',
      createdAt: m.createdAt ?? m.created_at ?? '',
      senderName: m.sender?.name ?? m.user?.name ?? '',
      content: m.content ?? '',
    }));
  },
});
