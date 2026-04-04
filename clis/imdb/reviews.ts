import { CommandExecutionError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import {
  forceEnglishUrl,
  getCurrentImdbId,
  isChallengePage,
  normalizeImdbId,
  waitForImdbPath,
  waitForImdbReviewsReady,
} from './utils.js';

/**
 * Read IMDb user reviews from the first review page.
 */
cli({
  site: 'imdb',
  name: 'reviews',
  description: 'Get user reviews for a movie or TV show',
  domain: 'www.imdb.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  args: [
    { name: 'id', positional: true, required: true, help: 'IMDb title ID (tt1375666) or URL' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of reviews' },
  ],
  columns: ['rank', 'title', 'rating', 'author', 'date', 'text'],
  func: async (page, args) => {
    const id = normalizeImdbId(String(args.id), 'tt');
    const limit = Math.max(1, Math.min(Number(args.limit) || 10, 25));
    const url = forceEnglishUrl(`https://www.imdb.com/title/${id}/reviews/`);

    await page.goto(url);
    const onReviewsPage = await waitForImdbPath(page, `^/title/${id}/reviews/?$`);
    const reviewsReady = await waitForImdbReviewsReady(page, 15000);

    if (await isChallengePage(page)) {
      throw new CommandExecutionError(
        'IMDb blocked this request',
        'Try again with a normal browser session or extension mode',
      );
    }
    if (!onReviewsPage || !reviewsReady) {
      throw new CommandExecutionError(
        'IMDb reviews did not finish loading',
        'Retry the command; if it persists, the review page structure may have changed',
      );
    }

    const currentId = await getCurrentImdbId(page, 'tt');
    if (currentId && currentId !== id) {
      throw new CommandExecutionError(
        `IMDb redirected to a different title: ${currentId}`,
        'Retry the command; if it persists, the review page may have changed',
      );
    }

    const reviews = await page.evaluate(`
      (function() {
        var limit = ${limit};
        var items = [];
        var containers = document.querySelectorAll('article.user-review-item, [data-testid="review-card-parent"], .imdb-user-review, [data-testid="review-card"], .review-container');

        for (var i = 0; i < containers.length && items.length < limit; i++) {
          var el = containers[i];
          var titleEl = el.querySelector('.title, [data-testid="review-summary"], a.title');
          var ratingEl = el.querySelector('.review-rating .ipc-rating-star--rating, .rating-other-user-rating span:first-child, [data-testid="review-rating"]');
          var authorEl = el.querySelector('.display-name-link a, [data-testid="author-link"], .author-text, a[href*="/user/"]');
          var dateEl = el.querySelector('.review-date, [data-testid="review-date"]');
          var textEl = el.querySelector('.content .text, .content .show-more__control, [data-testid="review-overflow"]');

          var title = titleEl ? (titleEl.textContent || '').trim() : '';
          var text = textEl ? (textEl.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200) : '';

          if (!title && !text) {
            continue;
          }

          // Deduplicate: IMDb renders both preview and expanded versions of each review
          var isDupe = false;
          for (var d = 0; d < items.length; d++) {
            if (items[d].title === title) { isDupe = true; break; }
          }
          if (isDupe) { continue; }

          items.push({
            title: title,
            rating: ratingEl ? (ratingEl.textContent || '').trim() : '',
            author: authorEl ? (authorEl.textContent || '').trim() : '',
            date: dateEl ? (dateEl.textContent || '').trim() : '',
            text: text
          });
        }

        return items;
      })()
    `);

    if (!Array.isArray(reviews)) {
      return [];
    }

    return reviews.map((item: any, index: number) => ({
      rank: index + 1,
      title: item.title || '',
      rating: item.rating || '',
      author: item.author || '',
      date: item.date || '',
      text: item.text || '',
    }));
  },
});
