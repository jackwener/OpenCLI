import { cli, Strategy } from '@jackwener/opencli/registry';
import { MACRO_OVERVIEW } from './data.js';

export const overviewCommand = cli({
  site: 'macro',
  name: 'overview',
  description: '查看宏观经济一手信息源上篇提纲',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['order', 'section', 'part', 'status', 'summary'],
  func: async () => MACRO_OVERVIEW,
});
