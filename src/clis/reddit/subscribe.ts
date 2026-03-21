import { cli, Strategy } from '../../registry.js';

cli({
  site: 'reddit',
  name: 'subscribe',
  description: 'Subscribe or unsubscribe to a subreddit',
  domain: 'reddit.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'subreddit', type: 'string', required: true, positional: true, help: 'Subreddit name (e.g. python)' },
    { name: 'undo', type: 'boolean', default: false, help: 'Unsubscribe instead of subscribe' },
  ],
  columns: ['status', 'message'],
  func: async (page, kwargs) => {
    if (!page) throw new Error('Requires browser');

    await page.goto('https://www.reddit.com');

    const result = await page.evaluate(`(async () => {
      try {
        let sub = ${JSON.stringify(kwargs.subreddit)};
        if (sub.startsWith('r/')) sub = sub.slice(2);

        const undo = ${kwargs.undo ? 'true' : 'false'};
        const action = undo ? 'unsub' : 'sub';

        // Get modhash
        const meRes = await fetch('/api/me.json', { credentials: 'include' });
        const me = await meRes.json();
        const modhash = me?.data?.modhash || '';

        const res = await fetch('/api/subscribe', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'sr_name=' + encodeURIComponent(sub)
            + '&action=' + action
            + (modhash ? '&uh=' + encodeURIComponent(modhash) : ''),
        });

        if (!res.ok) return { ok: false, message: 'HTTP ' + res.status };
        const label = undo ? 'Unsubscribed from' : 'Subscribed to';
        return { ok: true, message: label + ' r/' + sub };
      } catch (e) {
        return { ok: false, message: e.toString() };
      }
    })()`);

    return [{ status: result.ok ? 'success' : 'failed', message: result.message }];
  }
});
