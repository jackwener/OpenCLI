import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { LARK, ensureConsole, consoleApi, fmtUnix, truncate, joinList, roleLabel } from './utils.js';

// ── lark-console apps ───────────────────────────────────────────────────
//
// /developers/v1/app/list returns every app you own or collaborate on. It is the
// one console endpoint that authenticates off the cookie alone (no x-csrf-token).
cli({
  site: 'lark-console',
  name: 'apps',
  access: 'read',
  description: 'List the apps/bots in your Lark Open Platform developer console',
  domain: LARK,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [],
  columns: ['name', 'app_id', 'ability', 'version', 'role', 'updated'],
  func: async (page) => {
    await ensureConsole(page, LARK);
    const data = await consoleApi(page, LARK, '/developers/v1/app/list');
    const apps = data && Array.isArray(data.apps) ? data.apps : [];
    if (apps.length === 0) {
      throw new EmptyResultError('lark-console apps', 'No apps found on this developer-console account.');
    }
    return apps.map((a) => ({
      name: truncate(a.name, 40),
      app_id: a.appID || '',
      ability: joinList(a.ability),
      version: a.version || '',
      role: roleLabel(a.role),
      updated: fmtUnix(a.updateTime),
    }));
  },
});
