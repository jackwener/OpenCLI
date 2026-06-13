// attachment-download.js
// Save an attachment's bytes to a local file. Two-step to dodge CORS:
//
//   1. In page: GET /api/attachments/:id/url → { url, expiresAt }
//      (server-scoped, header auth, JSON response — no CDN cross-origin yet.)
//   2. In Node: fetch that signed CDN URL directly and stream to disk.
//
// Why not `GET /api/attachments/:id` which 302s to the CDN? Because the page
// fetch may not follow that redirect cross-origin (CORS pre-flight on the CDN
// host depends on its config). Going Node-side after the page hands us the
// URL sidesteps CORS entirely — fetch in Node has no Origin to enforce.
//
// We keep auth strictly in the page step (where the Slock session cookie is)
// and use no auth on the Node fetch because the URL is pre-signed (Bugen).

import fs from 'node:fs';
import path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { buildFetchSnippet } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';
import { UUID_RE } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'attachment-download',
  access: 'read',
  description: 'Download an attachment to a local file. Resolves a signed CDN URL in the page, then fetches bytes node-side (no CORS).',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'attachmentId', positional: true, required: true, help: 'Attachment UUID' },
    { name: 'out', help: 'Local path to write to. Defaults to ./<attachmentId>.bin' },
    { name: 'server', help: 'Override active server slug' },
  ],
  columns: ['attachmentId', 'out', 'sizeBytes'],
  func: async (page, kwargs) => {
    const id = String(kwargs.attachmentId ?? '').trim();
    if (!UUID_RE.test(id)) throw new ArgumentError(`attachmentId "${id}" is not a UUID`);
    const out = path.resolve(String(kwargs.out ?? `./${id}.bin`));

    // Step 1 — in-page, resolve the signed URL with the user's Slock session.
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
    const url = data?.url;
    if (!url) throw new CommandExecutionError(`no signed url returned for attachment ${id}`);

    // Step 2 — Node side, fetch the bytes from the signed CDN URL. No auth
    // header (URL is pre-signed); no Origin (Node fetch has none) so CORS
    // isn't in play.
    let res;
    try { res = await fetch(url); }
    catch (e) { throw new CommandExecutionError(`network error fetching signed URL: ${e.message}`); }
    if (!res.ok) {
      throw new CommandExecutionError(`HTTP ${res.status} from signed CDN URL while downloading ${id}`);
    }
    const ab = await res.arrayBuffer();
    fs.writeFileSync(out, Buffer.from(ab));
    return [{ attachmentId: id, out, sizeBytes: ab.byteLength }];
  },
});
