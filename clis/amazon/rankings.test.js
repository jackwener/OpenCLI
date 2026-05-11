import { describe, expect, it } from 'vitest';
import { __test__ } from './rankings.js';
describe('amazon rankings helpers', () => {
    it('normalizes ranking candidates with unified schema', () => {
        const result = __test__.normalizeRankingCandidate({
            rank_text: '#3',
            asin: 'B0DR31GC3D',
            title: 'Desk Shelves Desktop Organizer',
            href: 'https://www.amazon.com/dp/B0DR31GC3D/ref=zg_bs',
            price_text: '$25.92',
            rating_text: '4.3 out of 5 stars',
            review_count_text: '435',
        }, {
            listType: 'new_releases',
            rankFallback: 3,
            listTitle: 'Amazon New Releases',
            sourceUrl: 'https://www.amazon.com/gp/new-releases',
            categoryTitle: 'Home & Kitchen',
            categoryUrl: 'https://www.amazon.com/gp/new-releases/home-garden',
            categoryPath: ['Home & Kitchen'],
            visibleCategoryLinks: [{ title: 'Storage', url: 'https://www.amazon.com/gp/new-releases/storage', node_id: null }],
        });
        expect(result.list_type).toBe('new_releases');
        expect(result.rank).toBe(3);
        expect(result.asin).toBe('B0DR31GC3D');
        expect(result.product_url).toBe('https://www.amazon.com/dp/B0DR31GC3D');
        expect(result.category_title).toBe('Home & Kitchen');
        expect(result.visible_category_links).toEqual([
            { title: 'Storage', url: 'https://www.amazon.com/gp/new-releases/storage', node_id: null },
        ]);
    });
    it('deduplicates category links and parses rank fallback', () => {
        const links = __test__.normalizeVisibleCategoryLinks([
            { title: 'Kitchen', url: '/gp/new-releases/home-garden' },
            { title: 'Kitchen', url: 'https://www.amazon.com/gp/new-releases/home-garden' },
            { title: 'Storage', url: '/gp/new-releases/storage', node_id: '1064954' },
        ]);
        expect(links.length).toBe(2);
        expect(__test__.parseRank('N/A', 8)).toBe(8);
    });
});
