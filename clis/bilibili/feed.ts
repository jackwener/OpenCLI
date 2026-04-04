import { cli, Strategy } from '../../src/registry.js';
import { apiGet, payloadData, getSelfUid, stripHtml } from './utils.js';

cli({
  site: 'bilibili',
  name: 'feed',
  description: '关注的人的动态时间线',
  domain: 'www.bilibili.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    { name: 'type', default: 'all', help: 'Filter: all, video, article' },
  ],
  columns: ['rank', 'author', 'title', 'type', 'url'],
  func: async (page, kwargs) => {
    const { limit = 20, type = 'all' } = kwargs;

    const typeMap: Record<string, string> = { all: 'all', video: 'video', article: 'article' };
    const updateBaseline = '';

    const payload = await apiGet(page, '/x/polymer/web-dynamic/v1/feed/all', {
      params: {
        timezone_offset: -480,
        type: typeMap[type] ?? 'all',
        page: 1,
        ...(updateBaseline ? { update_baseline: updateBaseline } : {}),
      },
    });

    const items: any[] = payloadData(payload)?.items ?? [];
    const rows: any[] = [];

    for (let i = 0; i < Math.min(items.length, Number(limit)); i++) {
      const item = items[i];
      const modules = item.modules ?? {};
      const authorModule = modules.module_author ?? {};
      const dynamicModule = modules.module_dynamic ?? {};
      const major = dynamicModule.major ?? {};

      let title = '';
      let url = '';
      let itemType = item.type ?? '';

      if (major.archive) {
        title = major.archive.title ?? '';
        url = major.archive.jump_url ? `https:${major.archive.jump_url}` : '';
        itemType = 'video';
      } else if (major.article) {
        title = major.article.title ?? '';
        url = major.article.jump_url ? `https:${major.article.jump_url}` : '';
        itemType = 'article';
      } else if (dynamicModule.desc) {
        title = stripHtml(dynamicModule.desc.text ?? '').slice(0, 60);
        url = item.id_str ? `https://t.bilibili.com/${item.id_str}` : '';
        itemType = 'dynamic';
      }

      if (!title) continue;

      rows.push({
        rank: rows.length + 1,
        author: authorModule.name ?? '',
        title,
        type: itemType,
        url,
      });
    }

    return rows;
  },
});
