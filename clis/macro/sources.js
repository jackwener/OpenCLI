import { cli, Strategy } from '@jackwener/opencli/registry';
import { listMacroSources } from './data.js';

export const sourcesCommand = cli({
  site: 'macro',
  name: 'sources',
  description: '列出宏观经济一手信息源（来自《宏观经济一手信息源大全（上）》）',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'category', valueRequired: true, help: '按分组过滤：cn-national、cn-province、international-org，或中文分组名' },
    { name: 'limit', type: 'int', default: 50, help: '最多返回多少条' },
  ],
  columns: ['id', 'category', 'name', 'frequency', 'url', 'notes'],
  func: async (_page, kwargs) => listMacroSources({
    category: kwargs.category,
    limit: kwargs.limit,
  }),
});
