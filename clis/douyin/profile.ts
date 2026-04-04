import { cli, Strategy } from '../../registry.js';
import { browserFetch } from './_shared/browser-fetch.js';
import { CommandExecutionError } from '../../errors.js';
import type { IPage } from '../../types.js';

cli({
  site: 'douyin',
  name: 'profile',
  description: '获取账号信息',
  domain: 'creator.douyin.com',
  strategy: Strategy.COOKIE,
  args: [],
  columns: ['uid', 'nickname', 'follower_count', 'following_count', 'aweme_count'],
  func: async (page: IPage, _kwargs) => {
    const url = 'https://creator.douyin.com/web/api/media/user/info/?aid=1128';
    const res = (await browserFetch(page, 'GET', url)) as {
      user_info?: {
        uid: string;
        nickname: string;
        follower_count: number;
        following_count: number;
        aweme_count: number;
      };
      user?: {
        uid: string;
        nickname: string;
        follower_count: number;
        following_count: number;
        aweme_count: number;
      };
    };
    const u = res.user_info ?? res.user;
    if (!u) throw new CommandExecutionError('用户信息获取失败，请确认已登录 creator.douyin.com');
    return [
      {
        uid: u.uid,
        nickname: u.nickname,
        follower_count: u.follower_count,
        following_count: u.following_count,
        aweme_count: u.aweme_count,
      },
    ];
  },
});
