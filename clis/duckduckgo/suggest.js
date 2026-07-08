import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { requireBoundedInteger, requireSearchQuery } from '../_shared/search-adapter.js';

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
    const limit = requireBoundedInteger(kwargs.limit, 8, 1, 20, '--limit');
    const keyword = encodeURIComponent(requireSearchQuery(kwargs.keyword));
    const url = `https://duckduckgo.com/ac/?q=${keyword}&type=list`;
    let resp;
    try {
      resp = await fetch(url);
    } catch (err) {
      throw new CommandExecutionError(`DuckDuckGo suggest request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!resp.ok) {
      throw new CommandExecutionError(`DuckDuckGo suggest returned HTTP ${resp.status}`);
    }
    let data;
    try {
      data = await resp.json();
    } catch (err) {
      throw new CommandExecutionError(`DuckDuckGo suggest returned malformed JSON: ${err?.message ?? err}`);
    }
    const phrases = Array.isArray(data) && data.length > 1 && Array.isArray(data[1]) ? data[1] : [];
    return phrases
      .filter((phrase) => typeof phrase === 'string' && phrase.trim())
      .slice(0, limit)
      .map(function(p) { return { phrase: p }; });
  },
});

export const __test__ = { command };
