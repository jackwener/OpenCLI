// server-list.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';

cli({
  site: SLOCK_SITE,
  name: 'server-list',
  access: 'read',
  description: 'List slock servers you belong to; marks active per localStorage slug',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [],
  columns: ['id', 'slug', 'name', 'active'],
  func: async (page) => {
    await page.goto(SLOCK_HOME_URL);
    const snippet = `
      const token = localStorage.getItem('slock_access_token');
      if (!token) return { kind: 'auth', detail: 'no token' };
      const res = await fetch('${SLOCK_API_BASE}/servers/', { credentials:'include', headers:{authorization:'Bearer '+token,accept:'application/json'} });
      if (!res.ok) return { kind: res.status===401?'auth':'http', status: res.status, where: '/servers/' };
      const list = await res.json();
      const activeSlug = localStorage.getItem('slock_last_server_slug') || null;
      return { kind: 'ok', rows: Array.isArray(list) ? list : (list.servers || list.data || []), meta: { activeSlug } };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    const activeSlug = result.meta?.activeSlug ?? null;
    return rows.map((s) => ({
      id: s.id ?? '',
      slug: s.slug ?? '',
      name: s.name ?? '',
      active: s.slug === activeSlug,
    }));
  },
});
