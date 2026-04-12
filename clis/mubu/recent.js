import { cli, Strategy } from '@jackwener/opencli/registry';
import { formatDate, mubuPost } from './utils.js';

cli({
  site: 'mubu',
  name: 'recent',
  description: '最近编辑的幕布文档',
  domain: 'mubu.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20, help: '最多显示条数' },
  ],
  columns: ['id', 'name', 'updated'],
  func: async (page, kwargs) => {
    const limit = kwargs.limit;

    await page.goto('https://mubu.com/app');

    const data = await mubuPost(page, '/list/get', { folderId: 'recent' });

    return (data.documents ?? []).slice(0, limit).map((doc) => ({
      id: doc.id,
      name: doc.name,
      updated: formatDate(doc.updateTime),
    }));
  },
});
