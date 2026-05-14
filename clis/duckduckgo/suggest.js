import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { clampInt } from '../_shared/common.js';

const command = cli({
  site: 'duckduckgo',
  name: 'suggest',
  access: 'read',
  description: 'DuckDuckGo search suggestions',
  domain: 'duckduckgo.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'keyword', positional: true, required: true, help: 'Search query prefix' },
    { name: 'limit', type: 'int', default: 8, help: 'Max number of suggestions' },
  ],
  columns: ['phrase'],
  func: async (kwargs) => {
    const limit = clampInt(kwargs.limit, 8, 1, 20);
    const keyword = encodeURIComponent(String(kwargs.keyword));
    const url = `https://duckduckgo.com/ac/?q=${keyword}&type=list`;
    let resp;
    try {
      resp = await fetch(url);
    } catch (err) {
      throw new CliError('NETWORK_ERROR', `Failed to fetch suggestions: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!resp.ok) {
      throw new CliError('HTTP_ERROR', `Suggest API returned ${resp.status}`);
    }
    let data;
    try {
      data = await resp.json();
    } catch {
      throw new CliError('PARSE_ERROR', 'Failed to parse suggestion response');
    }
    const phrases = Array.isArray(data) && data.length > 1 && Array.isArray(data[1]) ? data[1] : [];
    return phrases.slice(0, limit).map(function(p) { return { phrase: p }; });
  },
});

export const __test__ = { command };
