import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    fetchNowcoderData,
    parseNowcoderPostTarget,
    projectNowcoderDetail,
} from './posts.js';

cli({
    site: 'nowcoder',
    name: 'detail',
    access: 'read',
    description: 'Content or moment detail (use an ID or URL returned by search/experience)',
    domain: 'www.nowcoder.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Numeric content ID, moment UUID, or canonical URL' },
    ],
    columns: ['post_type', 'id', 'uuid', 'entity_id', 'url', 'title', 'author', 'author_id', 'author_url', 'school', 'content', 'likes', 'comments', 'views', 'time', 'location'],
    func: async (page, args) => {
        const target = parseNowcoderPostTarget(args.id);
        const endpoint = target.post_type === 'content' ? 'content-data' : 'moment-data';
        const data = await fetchNowcoderData(
            page,
            `https://gw-c.nowcoder.com/api/sparta/detail/${endpoint}/detail/${encodeURIComponent(target.value)}`,
            { timeoutMs: 15_000 },
            'Nowcoder detail request',
        );
        return [projectNowcoderDetail(data, target)];
    },
});
