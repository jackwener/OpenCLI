import { cli, Strategy } from '@jackwener/opencli/registry';
import { mubuPost, htmlToText } from './utils.js';

cli({
  site: 'mubu',
  name: 'search',
  description: '全局搜索幕布文档和文件夹（标题+内容，服务端全量匹配）。结果含 type/id/name/path/hits/snippet 字段。',
  domain: 'mubu.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'query', positional: true, required: true, help: '搜索关键词' },
    { name: 'limit', type: 'int', default: 100, help: '最多显示条数（默认 100，结果被截断时用 --limit N 调大）' },
  ],
  columns: ['type', 'id', 'name', 'path', 'hits', 'snippet'],
  func: async (page, kwargs) => {
    const query = kwargs.query;
    const limit = kwargs.limit ?? 100;

    await page.goto('https://mubu.com/app');

    const data = await mubuPost(page, '/list/search', { keywords: query });

    const formatPath = (paths) => paths.map((p) => p.name).join(' > ');

    const folders = (data.folders ?? []).map((f) => ({
      type: 'folder',
      id: f.id,
      name: f.name,
      path: formatPath(f.paths),
      hits: '',
      snippet: '',
    }));

    const docs = (data.documents ?? []).map((d) => ({
      type: 'doc',
      id: d.id,
      name: d.name,
      path: formatPath(d.paths),
      hits: d.total > 0 ? String(d.total) : '',
      snippet: d.nodes
        .map((n) => htmlToText(n.text))
        .filter(Boolean)
        .join(' | '),
    }));

    const all = [...folders, ...docs];
    const result = all.slice(0, limit);

    if (all.length > limit) {
      result.push({
        type: '...',
        id: '',
        name: `还有 ${all.length - limit} 条未显示，用 --limit ${all.length} 查看全部`,
        path: '',
        hits: '',
        snippet: '',
      });
    }

    return result;
  },
});
