// server-use.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL, SLOCK_API_BASE } from './shared.js';
import { UUID_RE } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'server-use',
  access: 'write',
  description: 'Set the active slock server (writes localStorage.slock_last_server_slug)',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [{ name: 'input', positional: true, required: true, help: 'server slug, "#slug", or UUID id' }],
  columns: ['id', 'slug', 'name', 'written'],
  func: async (page, kwargs) => {
    const raw = String(kwargs.input ?? '').trim();
    if (!raw) throw new ArgumentError('input required: slug or UUID');
    const isUuid = UUID_RE.test(raw);
    const slug = raw.replace(/^#/, '').toLowerCase();
    const slugJson = JSON.stringify(slug);
    await page.goto(SLOCK_HOME_URL);
    const snippet = `
      const token = localStorage.getItem('slock_access_token');
      if (!token) return { kind: 'auth', detail: 'no token' };
      const res = await fetch('${SLOCK_API_BASE}/servers/', { credentials:'include', headers:{authorization:'Bearer '+token,accept:'application/json'} });
      if (!res.ok) return { kind: res.status===401?'auth':'http', status: res.status, where:'/servers/' };
      const list = await res.json();
      const arr = Array.isArray(list) ? list : (list.servers || list.data || []);
      let hit;
      if (${isUuid}) hit = arr.find((s) => s.id === ${JSON.stringify(raw)});
      else hit = arr.find((s) => (s.slug || '').toLowerCase() === ${slugJson});
      if (!hit) {
        const choices = arr.map((s) => s.slug).filter(Boolean).join(', ');
        return { kind: 'unresolvable', detail: 'no server matches ' + ${JSON.stringify(raw)} + '. Known slugs: ' + choices };
      }
      // ATOMICITY: write to localStorage ONLY after we have a confirmed hit.
      localStorage.setItem('slock_last_server_slug', hit.slug);
      return { kind: 'ok', rows: [hit], meta: { written: true, newSlug: hit.slug } };
    `;
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    return rows.map((s) => ({
      id: s.id ?? '',
      slug: s.slug ?? '',
      name: s.name ?? '',
      written: result.meta?.written ?? false,
    }));
  },
});
