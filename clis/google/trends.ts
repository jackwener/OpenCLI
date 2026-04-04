/**
 * Google Trends via public RSS feed.
 * Shows daily trending searches for a given region.
 */

import { cli, Strategy } from '../../src/registry.js';
import { CliError } from '../../src/errors.js';
import { parseRssItems } from './utils.js';

cli({
  site: 'google',
  name: 'trends',
  description: 'Get Google Trends daily trending searches',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'region', default: 'US', help: 'Region code (e.g. US, CN, JP)' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
  ],
  columns: ['title', 'traffic', 'date'],
  func: async (_page, args) => {
    const limit = Math.max(1, Math.min(Number(args.limit), 100));
    const region = encodeURIComponent(args.region);
    const url = `https://trends.google.com/trending/rss?geo=${region}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      throw new CliError('FETCH_ERROR', `HTTP ${resp.status}`, 'Check your network connection or region code');
    }

    const xml = await resp.text();
    const items = parseRssItems(xml, ['title', 'pubDate', 'ht:approx_traffic']);

    if (!items.length) {
      throw new CliError('NOT_FOUND', 'No trending data found', 'Try a different region code');
    }

    return items.slice(0, limit).map(item => ({
      title: item['title'],
      traffic: item['ht:approx_traffic'],  // raw string e.g. "1,000,000+", no numeric conversion
      date: item['pubDate'],
    }));
  },
});
