import { cli, Strategy } from '../../registry.js';
import { AuthRequiredError, CommandExecutionError } from '../../errors.js';

cli({
  site: 'reddit',
  name: 'saved',
  description: 'Browse your saved Reddit posts',
  domain: 'reddit.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 15 },
  ],
  columns: ['title', 'subreddit', 'score', 'comments', 'url'],
  func: async (page, kwargs) => {
    if (!page) throw new CommandExecutionError('Browser session required');

    await page.goto('https://www.reddit.com');

    const result = await page.evaluate(`(async () => {
      try {
        // Get current username
        const meRes = await fetch('/api/me.json?raw_json=1', { credentials: 'include' });
        const me = await meRes.json();
        const username = me?.name || me?.data?.name;
        if (!username) return { error: 'Not logged in — cannot determine username' };

        const limit = ${kwargs.limit};
        const res = await fetch('/user/' + username + '/saved.json?limit=' + limit + '&raw_json=1', {
          credentials: 'include'
        });
        const d = await res.json();
        return (d?.data?.children || []).map(c => ({
          title: c.data.title || c.data.body?.slice(0, 100) || '-',
          subreddit: c.data.subreddit_name_prefixed || 'r/' + (c.data.subreddit || '?'),
          score: c.data.score || 0,
          comments: c.data.num_comments || 0,
          url: 'https://www.reddit.com' + (c.data.permalink || ''),
        }));
      } catch (e) {
        return { error: e.toString() };
      }
    })()`);

    if (result?.error) throw new CommandExecutionError(result.error);
    return (result || []).slice(0, kwargs.limit);
  }
});
