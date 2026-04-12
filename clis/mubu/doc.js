import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { mubuPost, nodesToMarkdown, nodesToText } from './utils.js';

cli({
  site: 'mubu',
  name: 'doc',
  description: '读取幕布文档内容（默认输出 Markdown，可用 --output text 输出纯文本）',
  domain: 'mubu.com',
  strategy: Strategy.COOKIE,
  defaultFormat: 'plain',
  args: [
    { name: 'id', positional: true, required: true, help: '文档 ID' },
    { name: 'output', default: 'md', help: '输出格式：md（默认，缩进列表 Markdown，适合导入 Obsidian）或 text（纯文本，适合终端阅读）' },
  ],
  columns: ['content'],
  func: async (page, kwargs) => {
    const docId = kwargs.id;
    const format = kwargs.output;
    if (format !== 'md' && format !== 'text') {
      throw new ArgumentError(`--output 只接受 md 或 text，收到：${format}`);
    }

    await page.goto('https://mubu.com/app');

    const data = await mubuPost(page, '/document/edit/get', { docId });

    let nodes = [];
    try {
      const def = JSON.parse(data.definition);
      nodes = def.nodes ?? [];
    } catch {
      return [{ content: data.name }];
    }

    const output = format === 'md' ? nodesToMarkdown(nodes) : nodesToText(nodes);

    return [{ content: output }];
  },
});
