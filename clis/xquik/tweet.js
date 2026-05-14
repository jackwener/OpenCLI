import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeTweet, requireString, xquikFetch } from './utils.js';

cli({
    site: 'xquik',
    name: 'tweet',
    access: 'read',
    description: 'Look up one public X/Twitter post by ID through Xquik.',
    domain: 'xquik.com',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Numeric post ID' },
    ],
    columns: ['id', 'author', 'text', 'createdAt', 'likes', 'replies', 'retweets', 'quotes', 'views', 'url'],
    func: async (args) => {
        const id = encodeURIComponent(requireString(args.id, 'id'));
        const body = await xquikFetch(`/x/tweets/${id}`, 'xquik tweet');
        return [normalizeTweet(body?.tweet, 0, { author: body?.author })];
    },
});
