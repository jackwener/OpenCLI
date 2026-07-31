import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
  buildKeySkillSuggestionScript,
  ensureProfilePage,
  normalizeWhitespace,
} from './shared.js';

function parseLimit(value) {
  const limit = Number.parseInt(String(value ?? '10'), 10);
  if (!Number.isFinite(limit) || limit < 1 || limit > 25) {
    throw new ArgumentError('--limit must be between 1 and 25');
  }
  return limit;
}

cli({
  site: 'naukri',
  name: 'key-skills-suggest',
  access: 'read',
  description: 'Inspect Naukri key-skill autocomplete suggestions without saving changes',
  domain: 'www.naukri.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', type: 'str', required: true, help: 'Skill query to type into the Naukri key-skill autocomplete' },
    { name: 'limit', type: 'int', default: 10, help: 'Max suggestions to return (1-25)' },
  ],
  columns: ['rank', 'suggestion', 'source', 'endpoint'],
  func: async (page, kwargs) => {
    if (!page) throw new CommandExecutionError('Browser session required for naukri key-skills-suggest');
    const query = normalizeWhitespace(kwargs.query);
    if (!query) throw new ArgumentError('--query is required');
    const limit = parseLimit(kwargs.limit);
    await ensureProfilePage(page);
    const result = await page.evaluate(buildKeySkillSuggestionScript(query, limit));
    if (!result?.ok) {
      throw new CommandExecutionError(`Could not inspect Naukri key-skill suggestions: ${result?.error || 'unknown'}`);
    }
    return (result.suggestions || []).slice(0, limit).map((suggestion, index) => ({
      rank: index + 1,
      suggestion,
      source: result.source || (result.requests?.length ? 'autocomplete-network' : 'autocomplete-dom'),
      endpoint: result.endpoint || '',
    }));
  },
});

export const __test__ = {
  parseLimit,
};
