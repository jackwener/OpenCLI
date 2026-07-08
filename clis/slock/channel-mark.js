// channel-mark.js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { buildChannelScopedSnippet } from './in-page.js';
import { dispatchEvaluateResult } from './errors.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';

// Three read-state operations on one channel, selected by flags:
//   (default)   POST /channels/:id/read-all   — catch up fully
//   --seq N     POST /channels/:id/read {seq} — mark read up to a seq
//   --unread    POST /channels/:id/unread     — flag as unread
cli({
  site: SLOCK_SITE,
  name: 'channel-mark',
  access: 'write',
  description: 'Mark a channel read (default), read up to --seq, or --unread.',
  domain: SLOCK_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  args: [
    { name: 'channel', positional: true, required: true, help: 'channelId UUID or #name' },
    { name: 'seq', type: 'int', help: 'Mark read up to this seq (omit for read-all)' },
    { name: 'unread', type: 'bool', default: false, help: 'Mark the channel unread instead of read' },
    { name: 'server', help: 'Override active server' },
  ],
  columns: ['channel', 'action', 'result'],
  func: async (page, kwargs) => {
    const channel = String(kwargs.channel ?? '').trim();
    if (!channel) throw new ArgumentError('channel required');
    const hasSeq = kwargs.seq !== undefined && kwargs.seq !== null && kwargs.seq !== '';
    if (kwargs.unread && hasSeq) {
      throw new ArgumentError('--unread and --seq are mutually exclusive');
    }

    let pathSuffix;
    let body;
    let action;
    if (kwargs.unread) {
      pathSuffix = '/unread';
      action = 'unread';
    } else if (hasSeq) {
      const seq = Number(kwargs.seq);
      if (!Number.isInteger(seq) || seq <= 0) throw new ArgumentError(`--seq must be a positive integer (got "${kwargs.seq}")`);
      pathSuffix = '/read';
      body = { seq };
      action = `read-to-${seq}`;
    } else {
      pathSuffix = '/read-all';
      action = 'read-all';
    }

    await page.goto(SLOCK_HOME_URL);
    const snippet = buildChannelScopedSnippet({
      channelInput: channel,
      method: 'POST',
      pathSuffix,
      body,
      serverIdOverride: kwargs.server,
    });
    const result = await page.evaluate(`(async () => { ${snippet} })()`);
    const data = dispatchEvaluateResult(result);
    return [{
      channel,
      action,
      result: data?.seq !== undefined ? `seq=${data.seq}`
        : data?.unreadCount !== undefined ? `unreadCount=${data.unreadCount}`
        : 'ok',
    }];
  },
});
