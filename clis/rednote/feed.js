/**
 * Rednote home feed — delegates to the shared func-mode store read in
 * xiaohongshu/feed.js, run against www.rednote.com.
 *
 * The store read and URL-signing logic are identical to xiaohongshu (both
 * hydrate a Pinia `feed` store whose entries carry `xsecToken`), so this
 * adapter only pins the web host. Mirrors how rednote's note/comments/search/
 * download/user adapters reuse the xiaohongshu implementations.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { runFeed } from '../xiaohongshu/feed.js';

export const command = cli({
    site: 'rednote',
    name: 'feed',
    access: 'read',
    description: 'Rednote home feed (reads hydrated Pinia store)',
    domain: 'www.rednote.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of items to return' },
    ],
    columns: ['id', 'title', 'author', 'likes', 'type', 'url'],
    func: async (page, kwargs) => runFeed(page, kwargs, 'www.rednote.com'),
});
