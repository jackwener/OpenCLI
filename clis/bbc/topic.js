// bbc topic — BBC News headlines for a specific category, via public RSS.
//
// BBC publishes per-section RSS feeds at
// `https://feeds.bbci.co.uk/news/<topic>/rss.xml`. We expose the eight
// canonical sections and reject anything else with a typed argument error
// so the user knows the supported set.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { bbcFetchRss, parseRssItems, pubDateToIso, requireBoundedInt } from './utils.js';

const TOPICS = [
    'world',
    'business',
    'politics',
    'health',
    'education',
    'science_and_environment',
    'technology',
    'entertainment_and_arts',
];

cli({
    site: 'bbc',
    name: 'topic',
    access: 'read',
    description: 'BBC News headlines for a specific section (RSS feed)',
    domain: 'www.bbc.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'topic', positional: true, required: true, help: `Section name (${TOPICS.join(' / ')})` },
        { name: 'limit', type: 'int', default: 20, help: 'Max headlines (1-50)' },
    ],
    columns: ['rank', 'title', 'description', 'pubDate', 'url'],
    func: async (args) => {
        const raw = String(args.topic ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
        if (!TOPICS.includes(raw)) {
            throw new ArgumentError(
                `bbc topic "${args.topic}" is not supported`,
                `Supported topics: ${TOPICS.join(', ')}`,
            );
        }
        const limit = requireBoundedInt(args.limit, 20, 50);
        const xml = await bbcFetchRss(`${raw}/rss.xml`, `bbc topic ${raw}`);
        const items = parseRssItems(xml);
        if (!items.length) {
            throw new EmptyResultError('bbc topic', `BBC ${raw} feed returned no items.`);
        }
        return items.slice(0, limit).map((it, i) => ({
            rank: i + 1,
            title: it.title,
            description: it.description,
            pubDate: pubDateToIso(it.pubDate),
            url: it.link,
        }));
    },
});
