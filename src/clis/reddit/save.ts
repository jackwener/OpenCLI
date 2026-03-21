import { cli, Strategy } from '../../registry.js';

cli({
  site: 'reddit',
  name: 'save',
  description: 'Save or unsave a Reddit post',
  domain: 'reddit.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'post-id', type: 'string', required: true, positional: true, help: 'Post ID (e.g. 1abc123) or fullname (t3_xxx)' },
    { name: 'undo', type: 'boolean', default: false, help: 'Unsave instead of save' },
  ],
  columns: ['status', 'message'],
  func: async (page, kwargs) => {
    if (!page) throw new Error('Requires browser');

    await page.goto('https://www.reddit.com');

    const result = await page.evaluate(`(async () => {
      try {
        let postId = ${JSON.stringify(kwargs['post-id'])};
        const urlMatch = postId.match(/comments\\/([a-z0-9]+)/);
        if (urlMatch) postId = urlMatch[1];
        const fullname = postId.startsWith('t3_') || postId.startsWith('t1_')
          ? postId : 't3_' + postId;

        const undo = ${kwargs.undo ? 'true' : 'false'};
        const endpoint = undo ? '/api/unsave' : '/api/save';

        // Get modhash
        const meRes = await fetch('/api/me.json', { credentials: 'include' });
        const me = await meRes.json();
        const modhash = me?.data?.modhash || '';

        const res = await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'id=' + encodeURIComponent(fullname)
            + (modhash ? '&uh=' + encodeURIComponent(modhash) : ''),
        });

        if (!res.ok) return { ok: false, message: 'HTTP ' + res.status };
        return { ok: true, message: (undo ? 'Unsaved' : 'Saved') + ' ' + fullname };
      } catch (e) {
        return { ok: false, message: e.toString() };
      }
    })()`);

    return [{ status: result.ok ? 'success' : 'failed', message: result.message }];
  }
});
