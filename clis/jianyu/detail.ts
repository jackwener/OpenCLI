import { cli, Strategy } from '@jackwener/opencli/registry';
import { runProcurementDetail } from './shared/procurement-detail.js';

cli({
  site: 'jianyu',
  name: 'detail',
  description: '读取剑鱼标讯详情页并抽取证据字段',
  domain: 'www.jianyu360.cn',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'url', required: true, positional: true, help: 'Detail page URL from jianyu/search' },
    { name: 'query', help: 'Optional query for evidence ranking' },
  ],
  columns: ['title', 'publish_time', 'content_type', 'project_code', 'budget_or_limit', 'deadline_or_open_time', 'url'],
  func: async (page, kwargs) => runProcurementDetail(page, {
    url: kwargs.url,
    query: kwargs.query,
    site: 'jianyu',
  }),
});
