import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { CLS_DOMAIN, fetchJson, mapTelegraphRows, normalizeLimit } from './utils.js';

const TELEGRAPH_URL = 'https://www.cls.cn/api/cache?name=telegraph';

cli({
  site: 'cls',
  name: 'telegraph',
  access: 'read',
  description: '财联社电报快讯列表，默认返回最新 20 条',
  domain: CLS_DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: '返回数量 (max 100)' },
  ],
  columns: [
    'rank',
    'id',
    'title',
    'content',
    'subjects',
    'stocks',
    'level',
    'readingCount',
    'commentCount',
    'shareCount',
    'pubTime',
    'url',
  ],
  func: async (args) => {
    const limit = normalizeLimit(args.limit, 20, 100);
    const data = await fetchJson(TELEGRAPH_URL, 'cls telegraph');
    if (data?.errno !== 0) {
      throw new CommandExecutionError(`cls telegraph API returned errno=${data?.errno ?? 'unknown'}${data?.msg ? `: ${data.msg}` : ''}`);
    }
    return mapTelegraphRows(data?.data?.roll_data, limit);
  },
});
