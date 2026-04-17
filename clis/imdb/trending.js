import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractJsonLd, forceEnglishUrl, isChallengePage } from './utils.js';
/**
 * Fetch the IMDb Most Popular Movies (MovieMeter) list from JSON-LD structured data.
 */
cli({
    site: 'imdb',
    name: 'trending',
    description: 'IMDb Most Popular Movies',
    domain: 'www.imdb.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    ],
    columns: ['rank', 'title', 'rating', 'genre', 'url'],
    func: async (page, args) => {
        const url = forceEnglishUrl('https://www.imdb.com/chart/moviemeter/');
        await page.goto(url);
        await page.wait(2);
        if (await isChallengePage(page)) {
            throw new CommandExecutionError('IMDb blocked this request', 'Try again with a normal browser session or extension mode');
        }
        // Extract the ItemList JSON-LD block which contains all chart entries
        const ld = await extractJsonLd(page, 'ItemList');
        if (!ld || !Array.isArray(ld.itemListElement)) {
            throw new CommandExecutionError('Could not find chart data on page', 'IMDb may have changed their page structure');
        }
        const limit = Math.max(1, Math.min(Number(args.limit) || 20, 100));
        const items = ld.itemListElement.slice(0, limit);
        return items.map((entry, index) => {
            const item = entry.item || {};
            const rating = item.aggregateRating || {};
            const genre = Array.isArray(item.genre)
                ? item.genre.join(', ')
                : String(item.genre || '');
            // Normalize relative URLs to absolute IMDb URLs
            let itemUrl = item.url || '';
            if (itemUrl && !/^https?:\/\//.test(itemUrl)) {
                itemUrl = 'https://www.imdb.com' + itemUrl;
            }
            return {
                rank: entry.position || index + 1,
                title: String(item.name || ''),
                rating: rating.ratingValue != null ? String(rating.ratingValue) : '',
                genre,
                url: itemUrl,
            };
        });
    },
});
