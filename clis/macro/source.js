import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { findMacroSource, sourceDetailRows } from './data.js';

export const sourceCommand = cli({
  site: 'macro',
  name: 'source',
  description: '查看某个宏观经济一手信息源详情',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'id', required: true, positional: true, help: '信息源 id、名称或别名，如 stats-cn、央行、IMF' },
  ],
  columns: ['field', 'value'],
  func: async (_page, kwargs) => {
    const source = findMacroSource(kwargs.id);
    if (!source) {
      throw new ArgumentError(
        `Unknown macro source: ${kwargs.id}`,
        'Run "opencli macro sources" to list available source ids.',
      );
    }
    return sourceDetailRows(source);
  },
});
