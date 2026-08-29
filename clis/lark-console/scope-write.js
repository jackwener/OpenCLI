import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { LARK, ensureConsole, normalizeAppId, splitScopes, requireExecute, resolveScopeIds, updateScopes } from './utils.js';

const APP_ARG = { name: 'app', type: 'str', positional: true, required: true, help: 'App ID (cli_…) or a console URL containing it' };
const SCOPES_ARG = { name: 'scopes', type: 'str', positional: true, required: true, help: 'Scope name(s) or id(s), comma-separated (e.g. im:message,contact:contact.base:readonly)' };
const EXECUTE_ARG = { name: 'execute', type: 'boolean', default: false, help: 'Actually apply the change (otherwise refuses)' };

// ── lark-console add-scope ──────────────────────────────────────────────
//
// Applies tenant-token permission scopes to an app's draft config — the same
// action as ticking scopes in the console's "Add permission scopes to app" dialog.
// Scopes only go live once a new version is published (do that in the console).
cli({
  site: 'lark-console',
  name: 'add-scope',
  access: 'write',
  description: 'Apply permission scope(s) to an app (draft; requires --execute)',
  domain: LARK,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [APP_ARG, SCOPES_ARG, EXECUTE_ARG],
  columns: ['app_id', 'scope_id', 'operation', 'status'],
  func: async (page, kwargs) => {
    requireExecute(kwargs, 'add scopes');
    const appId = normalizeAppId(kwargs.app);
    if (!appId) throw new ArgumentError(`Could not parse an app id from "${kwargs.app}".`);
    await ensureConsole(page, LARK);
    const ids = await resolveScopeIds(page, LARK, appId, splitScopes(kwargs.scopes));
    await updateScopes(page, LARK, appId, ids, 'add');
    return ids.map((id) => ({ app_id: appId, scope_id: id, operation: 'add', status: 'ok' }));
  },
});

// ── lark-console remove-scope ───────────────────────────────────────────
cli({
  site: 'lark-console',
  name: 'remove-scope',
  access: 'write',
  description: 'Remove permission scope(s) from an app (draft; requires --execute)',
  domain: LARK,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [APP_ARG, SCOPES_ARG, EXECUTE_ARG],
  columns: ['app_id', 'scope_id', 'operation', 'status'],
  func: async (page, kwargs) => {
    requireExecute(kwargs, 'remove scopes');
    const appId = normalizeAppId(kwargs.app);
    if (!appId) throw new ArgumentError(`Could not parse an app id from "${kwargs.app}".`);
    await ensureConsole(page, LARK);
    const ids = await resolveScopeIds(page, LARK, appId, splitScopes(kwargs.scopes));
    await updateScopes(page, LARK, appId, ids, 'del');
    return ids.map((id) => ({ app_id: appId, scope_id: id, operation: 'remove', status: 'ok' }));
  },
});
