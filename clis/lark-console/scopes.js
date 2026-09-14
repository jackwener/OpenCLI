import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { LARK, ensureConsole, consoleApi, normalizeAppId, truncate } from './utils.js';

const APP_ARG = { name: 'app', type: 'str', positional: true, required: true, help: 'App ID (cli_…) or a console URL containing it' };

// ── lark-console scopes ─────────────────────────────────────────────────
//
// API permission scopes the app has applied for (POST /scope/applied). `scopeBizs`
// groups them by product area, so we resolve each scope's bizId to its readable name.
cli({
  site: 'lark-console',
  name: 'scopes',
  access: 'read',
  description: 'List the API permission scopes an app has applied for',
  domain: LARK,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [APP_ARG],
  columns: ['scope', 'biz', 'scope_id', 'desc'],
  func: async (page, kwargs) => {
    const appId = normalizeAppId(kwargs.app);
    if (!appId) throw new ArgumentError(`Could not parse an app id from "${kwargs.app}".`);
    await ensureConsole(page, LARK);
    const data = await consoleApi(page, LARK, `/developers/v1/scope/applied/${appId}`, { method: 'POST', body: {} });
    const scopes = data && Array.isArray(data.scopes) ? data.scopes : [];
    if (scopes.length === 0) {
      throw new EmptyResultError('lark-console scopes', `No applied scopes found for ${appId}.`);
    }
    const bizNames = new Map((data.scopeBizs || []).map((b) => [b.bizId, b.bizName]));
    return scopes.map((s) => ({
      scope: s.name || '',
      biz: bizNames.get(s.bizId) || s.bizId || '',
      scope_id: s.id || '',
      desc: truncate(s.desc, 70),
    }));
  },
});

// ── lark-console admins ─────────────────────────────────────────────────
cli({
  site: 'lark-console',
  name: 'admins',
  access: 'read',
  description: 'List an app’s admins / collaborators',
  domain: LARK,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [APP_ARG],
  columns: ['name', 'en_name', 'user_id'],
  func: async (page, kwargs) => {
    const appId = normalizeAppId(kwargs.app);
    if (!appId) throw new ArgumentError(`Could not parse an app id from "${kwargs.app}".`);
    await ensureConsole(page, LARK);
    const data = await consoleApi(page, LARK, `/developers/v1/admins/${appId}`);
    const admins = data && Array.isArray(data.admins) ? data.admins : [];
    if (admins.length === 0) {
      throw new EmptyResultError('lark-console admins', `No admins found for ${appId}.`);
    }
    return admins.map((a) => ({
      name: a.name || '',
      en_name: a.enName || '',
      user_id: a.userID || '',
    }));
  },
});
