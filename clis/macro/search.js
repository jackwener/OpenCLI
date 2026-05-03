import { cli, Strategy } from '@jackwener/opencli/registry';
import { searchMacroSources } from './data.js';

export const searchCommand = cli({
  site: 'macro',
  name: 'search',
  description: '搜索宏观经济一手信息源',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', required: true, positional: true, help: '搜索关键词，如 CPI、外汇、能源、IMF、财政' },
    { name: 'category', valueRequired: true, help: '按分组过滤：cn-national、cn-province、international-org，或中文分组名' },
    { name: 'limit', type: 'int', default: 20, help: '最多返回多少条' },
  ],
  columns: ['id', 'category', 'name', 'frequency', 'url', 'notes'],
  func: async (_page, kwargs) => searchMacroSources(kwargs.query, {
    category: kwargs.category,
    limit: kwargs.limit,
  }),
});
