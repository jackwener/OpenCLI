import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getMacroArticle } from './data.js';

export const articleCommand = cli({
  site: 'macro',
  name: 'article',
  aliases: ['body', 'text'],
  description: '阅读《宏观经济一手信息源大全（上）》正文',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'section', valueRequired: true, help: '只看指定章节：intro、cn-national、cn-province、international-org，或中文章节名' },
  ],
  columns: ['text'],
  defaultFormat: 'plain',
  func: async (_page, kwargs) => {
    const text = getMacroArticle(kwargs.section);
    if (!text) {
      throw new ArgumentError(
        `Unknown macro article section: ${kwargs.section}`,
        'Run "opencli macro overview" to see available sections.',
      );
    }
    return { text };
  },
});
