// attachment-url.js
// GET /api/attachments/:id/url → { url, expiresAt }. Just returns the signed
// CDN URL; does not transfer bytes. Useful for embedding in tools that take
// a URL (preview, copy/paste). Distinct from `attachment-download` which
// pulls bytes to local disk.
//
// Auth: flex-auth (Bearer + X-Server-Id via header — server accepts query too,
// but CLI uses header). Bugen source-verified.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { buildFetchSnippet } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';
import { UUID_RE } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'attachment-url',
  access: 'read',
  description: 'Get a short-lived signed CDN URL for an attachment (does not download bytes).',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'attachmentId', positional: true, required: true, help: 'Attachment UUID' },
    { name: 'server', help: 'Override active server slug' },
  ],
  columns: ['attachmentId', 'url', 'expiresAt'],
  func: async (page, kwargs) => {
    const id = String(kwargs.attachmentId ?? '').trim();
    if (!UUID_RE.test(id)) throw new ArgumentError(`attachmentId "${id}" is not a UUID`);
    await page.goto(SLOCK_HOME_URL);
    const snippet = buildFetchSnippet({
      method: 'GET',
      path: `/attachments/${encodeURIComponent(id)}/url`,
      serverScoped: true,
      serverIdOverride: kwargs.server,
    });
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const rows = dispatchEvaluateResult(result);
    const data = Array.isArray(rows) ? rows[0] : rows;
    if (!data?.url) {
      throw new CommandExecutionError(`no signed url returned for attachment ${id}`);
    }
    return [{
      attachmentId: id,
      url: data?.url ?? null,
      expiresAt: data?.expiresAt ?? null,
    }];
  },
});
