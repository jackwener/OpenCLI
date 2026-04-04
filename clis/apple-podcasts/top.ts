import { cli, Strategy } from '../../src/registry.js';
import { CliError } from '../../src/errors.js';

// Apple Marketing Tools RSS API — public, no key required
const CHARTS_URL = 'https://rss.marketingtools.apple.com/api/v2';
const CHARTS_TIMEOUT_MS = 15_000;

cli({
  site: 'apple-podcasts',
  name: 'top',
  description: 'Top podcasts chart on Apple Podcasts',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of podcasts (max 100)' },
    { name: 'country', default: 'us', help: 'Country code (e.g. us, cn, gb, jp)' },
  ],
  columns: ['rank', 'title', 'author', 'id'],
  func: async (_page, args) => {
    const limit = Math.max(1, Math.min(Number(args.limit), 100));
    const country = String(args.country || 'us').trim().toLowerCase();
    const url = `${CHARTS_URL}/${country}/podcasts/top/${limit}/podcasts.json`;
    let resp: Response;
    try {
      resp = await fetch(url, {
        signal: AbortSignal.timeout(CHARTS_TIMEOUT_MS),
      });
    } catch (error: any) {
      const reason = error?.cause?.code ?? error?.message ?? 'unknown network error';
      throw new CliError(
        'FETCH_ERROR',
        `Unable to reach Apple Podcasts charts for ${country.toUpperCase()}`,
        `Apple charts may be temporarily unavailable (${reason}). Try again later.`,
      );
    }
    if (!resp.ok) throw new CliError('FETCH_ERROR', `Charts API HTTP ${resp.status}`, `Check country code: ${country}`);
    const data = await resp.json();
    const results = data?.feed?.results;
    if (!results?.length) throw new CliError('NOT_FOUND', 'No chart data found', `Try a different country code`);
    return results.map((p: any, i: number) => ({
      rank: i + 1,
      title: p.name,
      author: p.artistName,
      id: p.id,
    }));
  },
});
