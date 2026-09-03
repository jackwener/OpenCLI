import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
  buildKeySkillSuggestionScript,
  ensureProfilePage,
  normalizeSkillList,
  normalizeWhitespace,
} from './shared.js';

function parseLimit(value) {
  const limit = Number.parseInt(String(value ?? '8'), 10);
  if (!Number.isFinite(limit) || limit < 1 || limit > 15) {
    throw new ArgumentError('--limit must be between 1 and 15');
  }
  return limit;
}

function comparable(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/\bjavascript\b/g, 'js')
    .replace(/\btypescript\b/g, 'ts')
    .replace(/\.js\b/g, 'js')
    .replace(/[^a-z0-9]+/g, '');
}

function isPlausibleMatch(input, suggestion) {
  const inputKey = comparable(input);
  const suggestionKey = comparable(suggestion);
  if (!inputKey || !suggestionKey) return false;
  return suggestionKey.includes(inputKey) || inputKey.includes(suggestionKey);
}

export function resolveSkill(input, suggestions) {
  const cleanInput = normalizeWhitespace(input);
  const cleanSuggestions = normalizeSkillList(suggestions);
  if (!cleanInput) {
    return { input: cleanInput, resolved: '', status: 'invalid', confidence: 'none', alternatives: '' };
  }
  if (!cleanSuggestions.length) {
    return { input: cleanInput, resolved: '', status: 'missing', confidence: 'none', alternatives: '' };
  }

  const exact = cleanSuggestions.find((suggestion) => suggestion.toLowerCase() === cleanInput.toLowerCase());
  if (exact) {
    return { input: cleanInput, resolved: exact, status: 'exact', confidence: 'high', alternatives: '' };
  }

  const alias = cleanSuggestions.find((suggestion) => comparable(suggestion) === comparable(cleanInput));
  if (alias) {
    return { input: cleanInput, resolved: alias, status: 'alias', confidence: 'high', alternatives: '' };
  }

  const plausible = cleanSuggestions.filter((suggestion) => isPlausibleMatch(cleanInput, suggestion));
  if (plausible.length === 1) {
    return { input: cleanInput, resolved: plausible[0], status: 'best_match', confidence: 'medium', alternatives: '' };
  }
  if (plausible.length > 1) {
    return {
      input: cleanInput,
      resolved: plausible[0],
      status: 'ambiguous',
      confidence: 'low',
      alternatives: plausible.slice(1, 5).join(', '),
    };
  }

  return {
    input: cleanInput,
    resolved: cleanSuggestions[0],
    status: 'weak_match',
    confidence: 'low',
    alternatives: cleanSuggestions.slice(1, 5).join(', '),
  };
}

cli({
  site: 'naukri',
  name: 'key-skills-resolve',
  access: 'read',
  description: 'Resolve desired key skills against Naukri autocomplete labels without saving changes',
  domain: 'www.naukri.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'skills', type: 'str', required: true, help: 'Comma, semicolon, or newline separated desired skill labels' },
    { name: 'limit', type: 'int', default: 8, help: 'Max suggestions to inspect per skill (1-15)' },
  ],
  columns: ['input', 'resolved', 'status', 'confidence', 'alternatives'],
  func: async (page, kwargs) => {
    if (!page) throw new CommandExecutionError('Browser session required for naukri key-skills-resolve');
    const skills = normalizeSkillList(kwargs.skills);
    if (!skills.length) throw new ArgumentError('--skills is required');
    const limit = parseLimit(kwargs.limit);
    await ensureProfilePage(page);

    const rows = [];
    for (const skill of skills) {
      const result = await page.evaluate(buildKeySkillSuggestionScript(skill, limit));
      if (!result?.ok) {
        const errorMessage = normalizeWhitespace(result?.error);
        rows.push({
          input: skill,
          resolved: '',
          status: 'error',
          confidence: 'none',
          alternatives: errorMessage ? errorMessage : 'key_skill_resolution_failed',
        });
        continue;
      }
      rows.push(resolveSkill(skill, result.suggestions || []));
    }
    return rows;
  },
});

export const __test__ = {
  parseLimit,
  resolveSkill,
};
