import { cli, Strategy } from '@jackwener/opencli/registry';
import { formatDate, mubuPost } from './utils.js';

cli({
  site: 'mubu',
  name: 'docs',
  description: '列出幕布文档（默认根目录，--starred 查看快速访问列表）',
  domain: 'mubu.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'folder', default: '0', help: '文件夹 ID（默认根目录 0）' },
    { name: 'starred', type: 'bool', default: false, help: '只显示快速访问的文档和文件夹' },
    { name: 'limit', type: 'int', default: 50, help: '最多显示条数' },
  ],
  columns: ['type', 'id', 'name', 'updated', 'stared'],
  func: async (page, kwargs) => {
    const folderId = kwargs.folder;
    const starred = kwargs.starred;
    const limit = kwargs.limit;

    await page.goto('https://mubu.com/app');
    const body = starred ? { source: 'star' } : { folderId };
    const data = await mubuPost(page, '/list/get', body);

    const folders = (data.folders ?? []).map((f) => ({
      type: '📁',
      id: f.id,
      name: f.name,
      updated: formatDate(f.updateTime),
      stared: f.stared ? '★' : '',
    }));

    const docs = (data.documents ?? []).map((doc) => ({
      type: '📄',
      id: doc.id,
      name: doc.name,
      updated: formatDate(doc.updateTime),
      stared: doc.stared ? '★' : '',
    }));

    return [...folders, ...docs].slice(0, limit);
  },
});
