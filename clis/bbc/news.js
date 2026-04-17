/**
 * BBC News headlines — public RSS feed, no browser needed.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'bbc',
    name: 'news',
    description: 'BBC News headlines (RSS)',
    domain: 'www.bbc.com',
    strategy: Strategy.PUBLIC,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of headlines (max 50)' },
    ],
    columns: ['rank', 'title', 'description', 'url'],
    func: async (page, kwargs) => {
        const count = Math.min(kwargs.limit || 20, 50);
        const resp = await fetch('https://feeds.bbci.co.uk/news/rss.xml');
        if (!resp.ok)
            return [];
        const xml = await resp.text();
        // Simple XML parsing without DOMParser (works in Node)
        const items = [];
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match;
        while ((match = itemRegex.exec(xml)) && items.length < count) {
            const block = match[1];
            const title = block.match(/<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)<\/title>/)?.[1] || block.match(/<title>(.*?)<\/title>/)?.[1] || '';
            const desc = block.match(/<description><!\[CDATA\[(.*?)\]\]>|<description>(.*?)<\/description>/)?.[1] || block.match(/<description>(.*?)<\/description>/)?.[1] || '';
            const link = block.match(/<link>(.*?)<\/link>/)?.[1] || block.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1] || '';
            if (title) {
                items.push({
                    rank: items.length + 1,
                    title: title.trim(),
                    description: desc.trim().substring(0, 200),
                    url: link.trim(),
                });
            }
        }
        return items;
    },
});
