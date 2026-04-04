import { CommandExecutionError } from '../../src/errors.js';
import { cli, Strategy } from '../../src/registry.js';

cli({
  site: 'reddit',
  name: 'upvote',
  description: 'Upvote or downvote a Reddit post',
  domain: 'reddit.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'post-id', type: 'string', required: true, positional: true, help: 'Post ID (e.g. 1abc123) or fullname (t3_xxx)' },
    { name: 'direction', type: 'string', default: 'up', help: 'Vote direction: up, down, none' },
  ],
  columns: ['status', 'message'],
  func: async (page, kwargs) => {
    if (!page) throw new CommandExecutionError('Browser session required');

    await page.goto('https://www.reddit.com');

    const result = await page.evaluate(`(async () => {
      try {
        let postId = ${JSON.stringify(kwargs['post-id'])};
        // Extract ID from URL if needed
        const urlMatch = postId.match(/comments\\/([a-z0-9]+)/);
        if (urlMatch) postId = urlMatch[1];
        // Build fullname
        const fullname = postId.startsWith('t3_') || postId.startsWith('t1_')
          ? postId : 't3_' + postId;

        const dir = ${JSON.stringify(kwargs.direction)};
        const direction = dir === 'down' ? -1 : dir === 'none' ? 0 : 1;

        // Get modhash from Reddit config
        const configEl = document.getElementById('config');
        let modhash = '';
        if (configEl) {
          modhash = configEl.querySelector('[name="uh"]')?.getAttribute('content') || '';
        }
        if (!modhash) {
          // Try fetching from /api/me.json
          const meRes = await fetch('/api/me.json', { credentials: 'include' });
          const me = await meRes.json();
          modhash = me?.data?.modhash || '';
        }

        const res = await fetch('/api/vote', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'id=' + encodeURIComponent(fullname)
            + '&dir=' + direction
            + (modhash ? '&uh=' + encodeURIComponent(modhash) : ''),
        });

        if (!res.ok) return { ok: false, message: 'HTTP ' + res.status };

        const labels = { '1': 'Upvoted', '-1': 'Downvoted', '0': 'Vote removed' };
        return { ok: true, message: (labels[String(direction)] || 'Voted') + ' ' + fullname };
      } catch (e) {
        return { ok: false, message: e.toString() };
      }
    })()`);

    return [{ status: result.ok ? 'success' : 'failed', message: result.message }];
  }
});
