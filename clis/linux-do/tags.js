import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchLinuxDoJson } from './feed.js';
cli({
    site: 'linux-do',
    name: 'tags',
    description: 'linux.do 标签列表',
    domain: 'linux.do',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 30, help: 'Number of tags' },
    ],
    columns: ['rank', 'name', 'count', 'url'],
    func: async (page, kwargs) => {
        const data = await fetchLinuxDoJson(page, '/tags.json');
        const tags = (data?.tags || []);
        tags.sort((a, b) => (b.count || 0) - (a.count || 0));
        return tags.slice(0, kwargs.limit).map((t, i) => ({
            rank: i + 1,
            name: t.name || t.id,
            count: t.count || 0,
            slug: t.slug,
            id: t.id,
            url: 'https://linux.do/tag/' + t.slug,
        }));
    },
});
