// unread-summary.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { authHeadersFragment } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';

// GET /servers/unread-summary is user-scoped (no X-Server-Id) and returns bare
// {serverId, unreadCount}. We enrich each row with the server's slug/name from
// GET /servers/ so the output is legible instead of opaque UUIDs.
cli({
  site: SLOCK_SITE,
  name: 'unread-summary',
  access: 'read',
  description: 'Global unread counts across every server you belong to.',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [],
  columns: ['serverId', 'slug', 'name', 'unreadCount'],
  func: async (page) => {
    await page.goto(SLOCK_HOME_URL);
    const snippet = `
      ${authHeadersFragment({ serverScoped: false })}
      const sres = await fetch('${SLOCK_API_BASE}/servers/', { credentials:'include', headers });
      if (sres.status === 401) return { kind: 'auth', detail: '/servers/ returned 401' };
      if (!sres.ok) return { kind: 'http', status: sres.status, where:'/servers/' };
      const servers = await sres.json();
      const ures = await fetch('${SLOCK_API_BASE}/servers/unread-summary', { credentials:'include', headers });
      if (ures.status === 401) return { kind: 'auth', detail: '/servers/unread-summary returned 401' };
      if (!ures.ok) return { kind: 'http', status: ures.status, where:'/servers/unread-summary' };
      const summary = await ures.json();
      const byId = {};
      (Array.isArray(servers) ? servers : []).forEach((s) => { if (s && s.id) byId[s.id] = s; });
      const rows = (Array.isArray(summary) ? summary : []).map((u) => {
        const s = byId[u.serverId] || {};
        return { serverId: u.serverId, slug: s.slug || '', name: s.name || '', unreadCount: u.unreadCount || 0 };
      });
      return { kind: 'ok', rows };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    if (!Array.isArray(rows)) {
      throw new CommandExecutionError(`expected array of summary rows, got ${typeof rows} (contract drift?)`);
    }
    return rows;
  },
});
