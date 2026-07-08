/**
 * 36kr latest news — public RSS feed, no browser needed.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: '36kr',
    name: 'news',
    access: 'read',
    description: 'Latest tech/startup news from 36kr (36氪)',
    domain: 'www.36kr.com',
    strategy: Strategy.PUBLIC,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of articles (max 50)' },
    ],
    columns: ['rank', 'title', 'summary', 'date', 'url'],
    func: async (kwargs) => {
        const count = Math.min(kwargs.limit || 20, 50);
        const resp = await fetch('https://www.36kr.com/feed', {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; opencli/1.0)' },
        });
        if (!resp.ok)
            return [];
        const xml = await resp.text();
        const items = [];
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match;
        while ((match = itemRegex.exec(xml)) && items.length < count) {
            const block = match[1];
            const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? '';
            const url = block.match(/<link><!\[CDATA\[(.*?)\]\]>/)?.[1] ??
                block.match(/<link>(.*?)<\/link>/)?.[1] ??
                '';
            const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? '';
            const date = pubDate.slice(0, 10);
            // Extract plain-text summary from HTML description (first ~120 chars)
            const rawDesc = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] ?? '';
            const summary = rawDesc
                .replace(/<[^>]+>/g, ' ')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 120);
            if (title) {
                items.push({ rank: items.length + 1, title, summary, date, url: url.trim() });
            }
        }
        return items;
    },
});
