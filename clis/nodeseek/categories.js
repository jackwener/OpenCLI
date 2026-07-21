// nodeseek categories — NodeSeek's top-level discussion boards.
//
// NodeSeek's category set is small and stable; the slugs map to
// www.nodeseek.com/categories/<slug>. Surfaced as a static reference so
// `latest --category <slug>` is self-documenting without a login or browser.
import { cli, Strategy } from '@jackwener/opencli/registry';

export const CATEGORIES = [
    { slug: 'daily', name: '日常' },
    { slug: 'tech', name: '技术' },
    { slug: 'info', name: '情报' },
    { slug: 'review', name: '测评' },
    { slug: 'trade', name: '交易' },
    { slug: 'carpool', name: '拼车' },
    { slug: 'promotion', name: '推广' },
    { slug: 'life', name: '生活' },
    { slug: 'dev', name: 'Dev' },
    { slug: 'photo-share', name: '贴图' },
    { slug: 'expose', name: '曝光' },
    { slug: 'inside', name: '内版' },
    { slug: 'sandbox', name: '沙盒' },
];

cli({
    site: 'nodeseek',
    name: 'categories',
    access: 'read',
    description: 'NodeSeek boards (slug + name)',
    domain: 'nodeseek.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [],
    columns: ['slug', 'name', 'url'],
    func: async () => CATEGORIES.map((c) => ({
        slug: c.slug,
        name: c.name,
        url: `https://www.nodeseek.com/categories/${c.slug}`,
    })),
});

export const __test__ = { CATEGORIES };
