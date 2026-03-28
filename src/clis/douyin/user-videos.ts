import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

cli({
  site: 'douyin',
  name: 'user-videos',
  description: '获取指定用户的视频列表（含下载地址和热门评论）',
  domain: 'www.douyin.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'sec_uid', type: 'string', required: true, positional: true, help: '用户 sec_uid（URL 末尾部分）' },
    { name: 'limit', type: 'int', default: 20, help: '获取数量' },
  ],
  columns: ['index', 'aweme_id', 'title', 'duration', 'digg_count', 'play_url', 'top_comments'],
  func: async (page: IPage, kwargs) => {
    await page.goto(`https://www.douyin.com/user/${kwargs.sec_uid as string}`);
    await page.wait(3);

    const result = await page.evaluate(`
      (async () => {
        const secUid = ${JSON.stringify(kwargs.sec_uid)};
        const limit = ${JSON.stringify(kwargs.limit)};

        const params = new URLSearchParams({
          sec_user_id: secUid,
          max_cursor: '0',
          count: String(limit),
          aid: '6383',
        });
        const res = await fetch('/aweme/v1/web/aweme/post/?' + params.toString(), {
          credentials: 'include',
          headers: { referer: 'https://www.douyin.com/' },
        });
        const data = await res.json();
        const awemeList = (data.aweme_list || []).slice(0, limit);

        const withComments = await Promise.all(awemeList.map(async (v) => {
          try {
            const cp = new URLSearchParams({
              aweme_id: v.aweme_id,
              count: '10',
              cursor: '0',
              aid: '6383',
            });
            const cr = await fetch('/aweme/v1/web/comment/list/?' + cp.toString(), {
              credentials: 'include',
              headers: { referer: 'https://www.douyin.com/' },
            });
            const cd = await cr.json();
            const comments = (cd.comments || []).slice(0, 10).map((c) => ({
              text: c.text,
              digg_count: c.digg_count,
              nickname: c.user && c.user.nickname,
            }));
            return { ...v, top_comments: comments };
          } catch {
            return { ...v, top_comments: [] };
          }
        }));

        return withComments;
      })()
    `) as Array<Record<string, unknown>>;

    return (result || []).map((v, i) => {
      const video = v.video as Record<string, unknown> | undefined;
      const playAddr = video?.play_addr as Record<string, unknown> | undefined;
      const urlList = playAddr?.url_list as string[] | undefined;
      const playUrl = urlList?.[0] ?? '';
      const statistics = v.statistics as Record<string, unknown> | undefined;
      return {
        index: i + 1,
        aweme_id: v.aweme_id as string,
        title: v.desc as string,
        duration: Math.round(((video?.duration as number) ?? 0) / 1000),
        digg_count: (statistics?.digg_count as number) ?? 0,
        play_url: playUrl,
        top_comments: v.top_comments as unknown[],
      };
    });
  },
});
