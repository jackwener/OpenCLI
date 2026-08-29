import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    fetchNowcoderData,
    projectNowcoderFeed,
    requirePositiveInt,
} from './posts.js';

cli({
    site: 'nowcoder',
    name: 'experience',
    access: 'read',
    description: 'Interview experience content and moment posts',
    domain: 'www.nowcoder.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'page', type: 'int', default: 1, help: 'Page number (1-1000)' },
        { name: 'limit', type: 'int', default: 15, help: 'Number of posts (1-50)' },
    ],
    columns: ['rank', 'post_type', 'id', 'uuid', 'entity_id', 'url', 'title', 'author', 'author_id', 'author_url', 'school', 'content', 'likes', 'comments', 'views', 'time'],
    func: async (page, args) => {
        const pageNumber = requirePositiveInt(args.page ?? 1, 'page', 1000);
        const limit = requirePositiveInt(args.limit ?? 15, 'limit', 50);
        const url = new URL('https://gw-c.nowcoder.com/api/sparta/home/tab/content');
        url.searchParams.set('tabId', '818');
        url.searchParams.set('categoryType', '1');
        url.searchParams.set('pageNo', String(pageNumber));
        url.searchParams.set('pageSize', String(limit));
        const data = await fetchNowcoderData(
            page,
            url.toString(),
            { timeoutMs: 15_000 },
            'Nowcoder experience request',
        );
        return projectNowcoderFeed(data.records, limit, 'experience');
    },
});
