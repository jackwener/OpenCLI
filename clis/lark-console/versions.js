import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { LARK, ensureConsole, consoleApi, normalizeAppId, fmtUnix, truncate, isOnlineVersion } from './utils.js';

// ── lark-console versions ───────────────────────────────────────────────
//
// Version history for an app. `online` flags the live published version
// (versionStatus 2); other status codes are historical/under-review states this
// adapter does not claim to decode, so it only surfaces what it can verify.
cli({
  site: 'lark-console',
  name: 'versions',
  access: 'read',
  description: 'List an app’s version history (which one is live, publish dates, release notes)',
  domain: LARK,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'app', type: 'str', positional: true, required: true, help: 'App ID (cli_…) or a console URL containing it' },
  ],
  columns: ['version', 'online', 'published', 'remark'],
  func: async (page, kwargs) => {
    const appId = normalizeAppId(kwargs.app);
    if (!appId) throw new ArgumentError(`Could not parse an app id from "${kwargs.app}".`);
    await ensureConsole(page, LARK);
    const data = await consoleApi(page, LARK, `/developers/v1/app_version/list/${appId}`);
    const versions = data && Array.isArray(data.versions) ? data.versions : [];
    if (versions.length === 0) {
      throw new EmptyResultError('lark-console versions', `No versions found for ${appId}.`);
    }
    return versions.map((v) => ({
      version: v.appVersion || '',
      online: isOnlineVersion(v.versionStatus) ? 'yes' : '',
      published: fmtUnix(v.publishTime),
      remark: truncate(v.updateRemark, 80),
    }));
  },
});
