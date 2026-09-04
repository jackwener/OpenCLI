import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { AISTUDIO_DOMAIN, filterModels, readAIStudioModels } from './utils.js';

export const modelsCommand = cli({
  site: 'aistudio',
  name: 'models',
  access: 'read',
  description: 'List models currently visible in the Google AI Studio model picker',
  domain: AISTUDIO_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: false,
  args: [
    {
      name: 'category',
      type: 'string',
      default: 'all',
      choices: ['all', 'text', 'image', 'video', 'audio', 'live', 'gemma'],
      help: 'Filter by model category',
    },
    { name: 'query', type: 'string', default: '', help: 'Filter by model id, name, or description' },
  ],
  columns: ['model', 'name', 'category', 'availability', 'description'],
  func: async (page, kwargs) => {
    const allModels = await readAIStudioModels(page, kwargs.category);
    const models = filterModels(allModels, { category: kwargs.category, query: kwargs.query });
    if (!models.length) {
      throw new EmptyResultError(
        'aistudio models',
        `No models match category=${kwargs.category} query=${JSON.stringify(kwargs.query)}.`,
      );
    }
    return models;
  },
});
