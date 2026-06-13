// channel-files.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { buildChannelScopedSnippet } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';
import { parsePositiveInteger } from './resolve.js';

cli({
  site: SLOCK_SITE,
  name: 'channel-files',
  access: 'read',
  description: 'List files shared in a channel (GET /channels/:id/files)',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'channel', positional: true, required: true, help: 'channelId UUID or #name' },
    { name: 'limit', type: 'int', default: 50, help: 'Max files' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['id', 'filename', 'mimeType', 'sizeBytes', 'messageId', 'createdAt'],
  func: async (page, kwargs) => {
    const channel = String(kwargs.channel ?? '').trim();
    if (!channel) throw new ArgumentError('channel required');
    const limit = parsePositiveInteger(kwargs.limit, '--limit', { defaultValue: 50 });
    await page.goto(SLOCK_HOME_URL);
    const snippet = buildChannelScopedSnippet({
      channelInput: channel,
      method: 'GET',
      pathSuffix: '/files',
      query: `?limit=${limit}`,
      serverIdOverride: kwargs.server,
    });
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const data = dispatchEvaluateResult(result);
    const files = Array.isArray(data) ? data : (data.files || []);
    if (!Array.isArray(files)) {
      throw new CommandExecutionError(`expected files array, got ${typeof files} (contract drift?)`);
    }
    return files.map((f) => ({
      id: f.id ?? '',
      filename: f.filename ?? '',
      mimeType: f.mimeType ?? '',
      sizeBytes: typeof f.sizeBytes === 'number' ? f.sizeBytes : null,
      messageId: f.messageId ?? '',
      createdAt: f.createdAt ?? '',
    }));
  },
});
