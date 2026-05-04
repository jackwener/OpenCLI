import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'reddit',
    name: 'subscribed',
    description: 'List subreddits you are subscribed to',
    access: 'read',
    domain: 'reddit.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 100, help: 'Max subreddits to return (auto-paginates; hard cap 1000)' },
    ],
    columns: ['subreddit', 'title', 'subscribers', 'description', 'url'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required');
        await page.goto('https://www.reddit.com');
        const result = await page.evaluate(`(async () => {
      try {
        const meRes = await fetch('/api/me.json?raw_json=1', { credentials: 'include' });
        const me = await meRes.json();
        const username = me?.name || me?.data?.name;
        if (!username) return { error: 'Not logged in — cannot list subscriptions' };

        const target = ${kwargs.limit};
        const HARD_CAP = 1000;
        const PAGE_SIZE = 100;
        const want = Math.min(target, HARD_CAP);
        const out = [];
        let after = null;
        while (out.length < want) {
          const remaining = want - out.length;
          const pageLimit = Math.min(PAGE_SIZE, remaining);
          const url = '/subreddits/mine/subscriptions.json?limit=' + pageLimit
            + '&raw_json=1'
            + (after ? '&after=' + encodeURIComponent(after) : '');
          const res = await fetch(url, { credentials: 'include' });
          if (!res.ok) return { error: 'HTTP ' + res.status + ' from ' + url };
          const d = await res.json();
          const children = d?.data?.children || [];
          for (const c of children) {
            out.push({
              subreddit: c.data.display_name_prefixed || ('r/' + (c.data.display_name || '?')),
              title: c.data.title || '',
              subscribers: c.data.subscribers || 0,
              description: (c.data.public_description || '').slice(0, 200),
              url: 'https://www.reddit.com' + (c.data.url || ''),
            });
          }
          after = d?.data?.after || null;
          if (!after || children.length === 0) break;
        }
        return out;
      } catch (e) {
        return { error: e.toString() };
      }
    })()`);
        if (result?.error) {
            if (String(result.error).includes('Not logged in'))
                throw new AuthRequiredError('reddit.com', result.error);
            throw new CommandExecutionError(result.error);
        }
        return (result || []).slice(0, kwargs.limit);
    }
});
