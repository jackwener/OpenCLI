/**
 * Instagram search-posts — search recent hashtag posts.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';

function readLimit(raw) {
    const limit = Number(raw ?? 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new ArgumentError('Argument "limit" must be an integer in [1, 50].');
    }
    return limit;
}

cli({
    site: 'instagram',
    name: 'search-posts',
    access: 'read',
    description: 'Search Instagram posts by hashtag',
    domain: 'www.instagram.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'query', type: 'string', required: true, positional: true, help: 'Hashtag or keyword to search (without #)' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of posts to return' },
    ],
    columns: ['rank', 'author', 'caption', 'likes', 'comments', 'url'],
    func: async (page, kwargs) => {
        const query = String(kwargs.query).replace(/^#/, '');
        const limit = readLimit(kwargs.limit);
        await page.goto('https://www.instagram.com');

        return page.evaluate(`(async () => {
      const query = ${JSON.stringify(query)};
      const limit = ${limit};
      const headers = { 'X-IG-App-ID': '936619743392459' };
      const opts = { credentials: 'include', headers };
      const resp = await fetch('https://www.instagram.com/api/v1/tags/web_info/?tag_name=' + encodeURIComponent(query), opts);
      if (!resp.ok) throw new Error('Failed to search: HTTP ' + resp.status);
      const data = await resp.json();
      const sections = data.data?.recent?.sections || data.data?.top?.sections || [];
      const posts = [];
      for (const section of sections) {
        const medias = section.layout_content?.medias || [];
        for (const m of medias) {
          const node = m.media;
          if (!node) continue;
          posts.push({
            rank: posts.length + 1,
            author: node.user?.username || '',
            caption: (node.caption?.text || '').replace(/\\n/g, ' ').substring(0, 150),
            likes: node.like_count || 0,
            comments: node.comment_count || 0,
            url: 'https://www.instagram.com/p/' + (node.code || node.shortcode || '') + '/',
          });
          if (posts.length >= limit) break;
        }
        if (posts.length >= limit) break;
      }
      return posts;
    })()`);
    },
});
