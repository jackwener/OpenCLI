import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { DOUBAO_DOMAIN, DOUBAO_CHAT_URL, getDoubaoPageState } from './common.js';

export const statusCommand = cli({
  site: 'doubao',
  name: 'status',
  description: 'Check Doubao chat page availability and login state',
  domain: DOUBAO_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['Status', 'Login', 'Url', 'Title'],
  func: async (page: IPage) => {
    const state = await getDoubaoPageState(page);
    const loggedIn = state.isLogin === null ? 'Unknown' : state.isLogin ? 'Yes' : 'No';
    const status = state.isLogin === false ? 'Login Required' : 'Connected';

    return [{
      Status: status,
      Login: loggedIn,
      Url: state.url,
      Title: state.title || 'Doubao',
    }];
  },
});
