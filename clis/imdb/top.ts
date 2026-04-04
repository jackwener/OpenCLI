import { CommandExecutionError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import { extractJsonLd, forceEnglishUrl, isChallengePage } from './utils.js';

/**
 * Fetch the IMDb Top 250 Movies list from JSON-LD structured data on the chart page.
 */
cli({
  site: 'imdb',
  name: 'top',
  description: 'IMDb Top 250 Movies',
  domain: 'www.imdb.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
  ],
  columns: ['rank', 'title', 'rating', 'votes', 'genre', 'url'],
  func: async (page, args) => {
    const url = forceEnglishUrl('https://www.imdb.com/chart/top/');

    await page.goto(url);
    await page.wait(2);

    if (await isChallengePage(page)) {
      throw new CommandExecutionError(
        'IMDb blocked this request',
        'Try again with a normal browser session or extension mode',
      );
    }

    // Extract the ItemList JSON-LD block which contains all chart entries
    const ld = await extractJsonLd(page, 'ItemList');
    if (!ld || !Array.isArray(ld.itemListElement)) {
      throw new CommandExecutionError(
        'Could not find chart data on page',
        'IMDb may have changed their page structure',
      );
    }

    const limit = Math.max(1, Math.min(Number(args.limit) || 20, 250));
    const items = (ld.itemListElement as any[]).slice(0, limit);

    return items.map((entry: any, index: number) => {
      const item = entry.item || {};
      const rating = item.aggregateRating || {};
      const genre = Array.isArray(item.genre)
        ? item.genre.join(', ')
        : String(item.genre || '');

      // Normalize relative URLs to absolute IMDb URLs
      let itemUrl: string = item.url || '';
      if (itemUrl && !/^https?:\/\//.test(itemUrl)) {
        itemUrl = 'https://www.imdb.com' + itemUrl;
      }

      return {
        rank: entry.position || index + 1,
        title: String(item.name || ''),
        rating: rating.ratingValue != null ? String(rating.ratingValue) : '',
        votes: rating.ratingCount != null ? String(rating.ratingCount) : '',
        genre,
        url: itemUrl,
      };
    });
  },
});
