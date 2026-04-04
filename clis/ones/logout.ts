import { cli, Strategy } from '../../src/registry.js';
import { onesFetchInPage } from './common.js';

cli({
  site: 'ones',
  name: 'logout',
  description: 'ONES Project API — invalidate current token (GET auth/logout) via Chrome Bridge',
  domain: 'ones.cn',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['ok', 'detail'],

  func: async (page) => {
    await onesFetchInPage(page, 'auth/logout', { method: 'GET' });
    return [{ ok: 'true', detail: 'Server logout ok; clear local ONES_AUTH_TOKEN if set.' }];
  },
});
