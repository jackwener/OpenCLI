import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchLinuxDoJson } from './feed.js';
cli({
    site: 'linux-do',
    name: 'categories',
    description: 'linux.do 分类列表',
    domain: 'linux.do',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'subcategories', type: 'boolean', default: false, help: 'Include subcategories' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of categories' },
    ],
    columns: ['name', 'slug', 'id', 'topics', 'description'],
    func: async (page, kwargs) => {
        const data = await fetchLinuxDoJson(page, '/categories.json');
        const cats = (data?.category_list?.categories || []);
        const showSub = !!kwargs.subcategories;
        const limit = kwargs.limit;
        const results = [];
        for (const c of cats) {
            if (results.length >= limit)
                break;
            results.push({
                name: c.name,
                slug: c.slug,
                id: c.id,
                topics: c.topic_count,
                description: (c.description_text || '').slice(0, 80),
            });
            if (showSub && Array.isArray(c.subcategory_ids) && c.subcategory_ids.length > 0) {
                const subData = await fetchLinuxDoJson(page, `/categories.json?parent_category_id=${c.id}`, { skipNavigate: true });
                const subCats = (subData?.category_list?.categories || []);
                for (const sc of subCats) {
                    if (results.length >= limit)
                        break;
                    results.push({
                        name: c.name + ' / ' + sc.name,
                        slug: sc.slug,
                        id: sc.id,
                        topics: sc.topic_count,
                        description: (sc.description_text || '').slice(0, 80),
                    });
                }
            }
        }
        return results;
    },
});
