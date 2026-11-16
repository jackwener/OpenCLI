import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { command as search, noteKeyFromUrl } from './search.js';
import { parsePrivateUserId } from './im.js';
import { positiveInteger } from '../_shared/private-messages.js';

export function parseNearbyArgs(args) {
    const query = String(args.query ?? '').trim();
    if (!query) throw new ArgumentError('nearby requires a search keyword; this is location-filtered search, not the App nearby recommendation feed');
    const scope = args.scope ?? 'nearby';
    if (!['nearby', 'same-city'].includes(scope)) throw new ArgumentError('--scope must be nearby or same-city');
    return { query, scope, limit: positiveInteger(args.limit, 20, 100, '--limit') };
}

export function projectNearbyRow(row, scope, index) {
    const id = noteKeyFromUrl(row.url, 'www.xiaohongshu.com');
    if (!id || !row.author_url) throw new CommandExecutionError('Xiaohongshu nearby result is missing a stable post or author identity');
    const peer = parsePrivateUserId(row.author_url);
    return {
        rank: index + 1, post_id: id, title: row.title, author: row.author,
        author_id: peer, author_url: row.author_url, likes: row.likes,
        published_at: row.published_at, location_source: `platform-search:${scope}`,
        distance_meters: null, url: row.url,
    };
}

export const command = cli({
    site: 'xiaohongshu', name: 'nearby', access: 'read', description: '搜索附近/同城笔记；必须成功应用网页位置筛选，不回退普通搜索',
    domain: 'www.xiaohongshu.com', strategy: Strategy.COOKIE, browser: true, navigateBefore: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword (not an App recommendation feed)' },
        { name: 'scope', default: 'nearby', choices: ['nearby', 'same-city'], help: 'Platform location filter' },
        { name: 'limit', type: 'int', default: 20, help: 'Maximum posts (1-100)' },
    ],
    columns: ['rank', 'post_id', 'title', 'author', 'author_id', 'author_url', 'likes', 'published_at', 'location_source', 'distance_meters', 'url'],
    validateArgs: args => { parseNearbyArgs(args); },
    func: async (page, args) => {
        const options = parseNearbyArgs(args);
        const rows = await search.func(page, { query: options.query, location: options.scope, limit: options.limit });
        return rows.map((row, index) => projectNearbyRow(row, options.scope, index));
    },
});
