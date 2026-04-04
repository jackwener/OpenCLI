import { cli, Strategy } from '../../registry.js';
import { apiGet, payloadData, getSelfUid } from './utils.js';

cli({
  site: 'bilibili',
  name: 'favorite',
  description: '我的默认收藏夹',
  domain: 'www.bilibili.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    { name: 'page', type: 'int', default: 1, help: 'Page number' },
  ],
  columns: ['rank', 'title', 'author', 'plays', 'url'],
  func: async (page, kwargs) => {
    const { limit = 20, page: pageNum = 1 } = kwargs;

    // Get current user's UID
    const uid = await getSelfUid(page);

    // Get default favorite folder ID
    const foldersPayload = await apiGet(page, '/x/v3/fav/folder/created/list-all', {
      params: { up_mid: uid },
      signed: true,
    });
    const folders = payloadData(foldersPayload)?.list ?? [];
    if (!folders.length) return [];
    const fid = folders[0].id;

    // Fetch favorite items
    const payload = await apiGet(page, '/x/v3/fav/resource/list', {
      params: { media_id: fid, pn: pageNum, ps: Math.min(Number(limit), 40) },
      signed: true,
    });
    const medias: any[] = payloadData(payload)?.medias ?? [];

    return medias.slice(0, Number(limit)).map((item: any, i: number) => ({
      rank: i + 1,
      title: item.title ?? '',
      author: item.upper?.name ?? '',
      plays: item.cnt_info?.play ?? 0,
      url: item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : '',
    }));
  },
});
