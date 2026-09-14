import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { LARK, ensureConsole, consoleApi, normalizeAppId, truncate, joinList } from './utils.js';

const APP_ARG = { name: 'app', type: 'str', positional: true, required: true, help: 'App ID (cli_…) or a console URL containing it' };

// ── lark-console app ────────────────────────────────────────────────────
cli({
  site: 'lark-console',
  name: 'app',
  access: 'read',
  description: 'Show one app’s basic info (name, abilities, languages, description)',
  domain: LARK,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [APP_ARG],
  columns: ['app_id', 'name', 'ability', 'primary_lang', 'langs', 'desc'],
  func: async (page, kwargs) => {
    const appId = normalizeAppId(kwargs.app);
    if (!appId) throw new ArgumentError(`Could not parse an app id from "${kwargs.app}".`);
    await ensureConsole(page, LARK);
    const data = await consoleApi(page, LARK, `/developers/v1/app/${appId}`);
    if (!data || !data.clientID) {
      throw new EmptyResultError('lark-console app', `No app found for ${appId}. Check the id, or that this account can access the app.`);
    }
    return [{
      app_id: data.clientID || appId,
      name: truncate(data.name, 60),
      ability: joinList(data.ability),
      primary_lang: data.primaryLang || '',
      langs: joinList(data.langs),
      desc: truncate(data.desc, 80),
    }];
  },
});

// ── lark-console secret ─────────────────────────────────────────────────
//
// Reveals the App ID + App Secret (same value the console "Credentials & Basic
// Info" page shows) so you can wire a bot into a runtime such as cc-lark.
cli({
  site: 'lark-console',
  name: 'secret',
  access: 'read',
  description: 'Reveal an app’s App ID + App Secret (credentials for a bot runtime)',
  domain: LARK,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [APP_ARG],
  columns: ['app_id', 'app_secret'],
  func: async (page, kwargs) => {
    const appId = normalizeAppId(kwargs.app);
    if (!appId) throw new ArgumentError(`Could not parse an app id from "${kwargs.app}".`);
    await ensureConsole(page, LARK);
    const data = await consoleApi(page, LARK, `/developers/v1/secret/${appId}`);
    if (!data || !data.secret) {
      throw new EmptyResultError('lark-console secret', `No secret returned for ${appId}. Check the id, or that this account owns/administers the app.`);
    }
    return [{ app_id: appId, app_secret: data.secret }];
  },
});
