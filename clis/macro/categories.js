import { cli, Strategy } from '@jackwener/opencli/registry';
import { listMacroCategories } from './data.js';

export const categoriesCommand = cli({
  site: 'macro',
  name: 'categories',
  description: '列出宏观经济一手信息源分组',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['id', 'name', 'part', 'sources', 'summary'],
  func: async () => listMacroCategories(),
});
