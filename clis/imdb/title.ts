import { CommandExecutionError } from '../../src/errors.js';
import { cli, Strategy } from '../../src/registry.js';
import {
  extractJsonLd,
  forceEnglishUrl,
  formatDuration,
  getCurrentImdbId,
  isChallengePage,
  normalizeImdbId,
  waitForImdbPath,
} from './utils.js';

/**
 * Read IMDb title details from JSON-LD on the public page.
 */
cli({
  site: 'imdb',
  name: 'title',
  description: 'Get movie or TV show details',
  domain: 'www.imdb.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  args: [
    { name: 'id', positional: true, required: true, help: 'IMDb title ID (tt1375666) or URL' },
  ],
  columns: ['field', 'value'],
  func: async (page, args) => {
    const id = normalizeImdbId(String(args.id), 'tt');
    const url = forceEnglishUrl(`https://www.imdb.com/title/${id}/`);

    await page.goto(url);
    const onTitlePage = await waitForImdbPath(page, `^/title/${id}/`);

    if (await isChallengePage(page)) {
      throw new CommandExecutionError(
        'IMDb blocked this request',
        'Try again with a normal browser session or extension mode',
      );
    }
    if (!onTitlePage) {
      throw new CommandExecutionError(
        `Title page did not finish loading: ${id}`,
        'Retry the command; if it persists, IMDb may have changed their navigation flow',
      );
    }

    const currentId = await getCurrentImdbId(page, 'tt');
    if (currentId && currentId !== id) {
      throw new CommandExecutionError(
        `IMDb redirected to a different title: ${currentId}`,
        'Retry the command; if it persists, the title page may have changed',
      );
    }

    // Single browser roundtrip: fetch title JSON-LD by type whitelist
    const titleTypes = ['Movie', 'TVSeries', 'TVEpisode', 'TVMiniseries', 'TVMovie', 'TVSpecial', 'VideoGame', 'ShortFilm'];
    const ld = await extractJsonLd(page, titleTypes);
    if (!ld) {
      throw new CommandExecutionError(`Title not found: ${id}`, 'Check the title ID and try again');
    }

    const data = ld as Record<string, any>;
    const type = String(data['@type'] || '');
    const isTvSeries = type === 'TVSeries' || type === 'TVMiniseries';

    // Handle both array and single-object JSON-LD person fields
    const toPeople = (arr: any): string => {
      if (!arr) return '';
      const list = Array.isArray(arr) ? arr : [arr];
      return list
        .slice(0, 5)
        .map((p: any) => p.name || '')
        .filter(Boolean)
        .join(', ');
    };

    const year = (() => {
      if (isTvSeries && typeof data.startDate === 'string') {
        const startYear = data.startDate.split('-')[0] || '';
        const endYear = typeof data.endDate === 'string' ? data.endDate.split('-')[0] || '' : '';
        // Show "2024-" for ongoing series (no endDate) or "2010-2015" for ended ones
        return endYear ? `${startYear}-${endYear}` : `${startYear}-`;
      }
      if (typeof data.datePublished === 'string') {
        return data.datePublished.split('-')[0] || '';
      }
      return '';
    })();

    const directorField = isTvSeries ? 'creator' : 'director';
    const directorValue = isTvSeries ? toPeople(data.creator) : toPeople(data.director);

    const fields: Record<string, string> = {
      title: String(data.name || ''),
      type,
      year,
      rating: data.aggregateRating?.ratingValue != null ? String(data.aggregateRating.ratingValue) : '',
      votes: data.aggregateRating?.ratingCount != null ? String(data.aggregateRating.ratingCount) : '',
      genre: Array.isArray(data.genre) ? data.genre.join(', ') : String(data.genre || ''),
      [directorField]: directorValue,
      cast: toPeople(data.actor),
      duration: formatDuration(String(data.duration || '')),
      contentRating: String(data.contentRating || ''),
      plot: String(data.description || ''),
      url: `https://www.imdb.com/title/${id}/`,
    };

    if (isTvSeries) {
      if (data.numberOfSeasons != null) {
        fields.seasons = String(data.numberOfSeasons);
      }
      if (data.numberOfEpisodes != null) {
        fields.episodes = String(data.numberOfEpisodes);
      }
    }

    return Object.entries(fields)
      .filter(([, value]) => value !== '')
      .map(([field, value]) => ({ field, value }));
  },
});
