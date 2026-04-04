/**
 * Google News via public RSS feed.
 * Supports top stories (no keyword) and search (with keyword).
 */

import { cli, Strategy } from '../../src/registry.js';
import { CliError } from '../../src/errors.js';
import { parseRssItems } from './utils.js';

cli({
  site: 'google',
  name: 'news',
  description: 'Get Google News headlines',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'keyword', positional: true, help: 'Search query (omit for top stories)' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of results' },
    { name: 'lang', default: 'en', help: 'Language short code (e.g. en, zh)' },
    { name: 'region', default: 'US', help: 'Region code (e.g. US, CN)' },
  ],
  columns: ['title', 'source', 'date', 'url'],
  func: async (_page, args) => {
    const limit = Math.max(1, Math.min(Number(args.limit), 100));
    const lang = encodeURIComponent(args.lang);
    const region = encodeURIComponent(args.region);
    const ceid = `${args.region}:${args.lang}`;

    // Top stories or search
    const base = args.keyword
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(args.keyword)}&hl=${lang}&gl=${region}&ceid=${ceid}`
      : `https://news.google.com/rss?hl=${lang}&gl=${region}&ceid=${ceid}`;

    const resp = await fetch(base);
    if (!resp.ok) {
      throw new CliError('FETCH_ERROR', `HTTP ${resp.status}`, 'Check your network connection');
    }

    const xml = await resp.text();
    const items = parseRssItems(xml, ['title', 'link', 'pubDate', 'source']);

    if (!items.length) {
      throw new CliError('NOT_FOUND', 'No news articles found', 'Try a different keyword or region');
    }

    return items.slice(0, limit).map(item => {
      // Extract source: prefer <source> element, fallback to parsing title
      let title = item['title'] || '';
      let source = item['source'] || '';
      if (!source) {
        const idx = title.lastIndexOf(' - ');
        if (idx !== -1) {
          source = title.slice(idx + 3);
          title = title.slice(0, idx);
        }
      }

      return {
        title,
        source,
        date: item['pubDate'] || '',
        url: item['link'] || '',
      };
    });
  },
});
