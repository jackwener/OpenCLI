// channel-create.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { buildFetchSnippet } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';

// Public/private only. Joint channels need a target server slug + invitees and
// are out of scope here. Server-side this requires the manageChannels capability
// (admin); non-admins get HTTP 403.
cli({
  site: SLOCK_SITE,
  name: 'channel-create',
  access: 'write',
  description: 'Create a channel — admin only (POST /channels/). Public unless --private.',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'name', positional: true, required: true, help: 'Channel name' },
    { name: 'description', help: 'Channel description / topic (≤500 chars)' },
    { name: 'private', type: 'bool', default: false, help: 'Create a private channel instead of public' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['id', 'name', 'type', 'result'],
  func: async (page, kwargs) => {
    const name = String(kwargs.name ?? '').trim();
    if (!name) throw new ArgumentError('name required');
    const description = kwargs.description !== undefined ? String(kwargs.description) : undefined;
    if (description !== undefined && description.length > 500) {
      throw new ArgumentError('--description must be at most 500 characters');
    }
    const body = { name, visibility: kwargs.private ? 'private' : 'public' };
    if (description !== undefined) body.description = description;
    await page.goto(SLOCK_HOME_URL);
    const snippet = buildFetchSnippet({
      method: 'POST',
      path: '/channels/',
      body,
      serverScoped: true,
      serverIdOverride: kwargs.server,
    });
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const data = dispatchEvaluateResult(result);
    return [{ id: data?.id ?? '', name: data?.name ?? name, type: data?.type ?? '', result: 'created' }];
  },
});
