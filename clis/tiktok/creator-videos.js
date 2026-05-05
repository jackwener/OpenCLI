import { cli } from '@jackwener/opencli/registry';

const ITEM_LIST_API_PATH = '/tiktok/creator/manage/item_list/v1/';

cli({
    site: 'tiktok',
    name: 'creator-videos',
    access: 'read',
    description: 'TikTok Studio creator content list (views/likes/comments/saves/shares)',
    domain: 'www.tiktok.com',
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of creator videos to return' },
        { name: 'cursor', type: 'string', default: '0', help: 'Pagination cursor' },
    ],
    columns: ['title', 'date', 'views', 'likes', 'comments', 'saves', 'shares', 'url'],
    pipeline: [
        { navigate: { url: 'https://www.tiktok.com/tiktokstudio/content', settleMs: 6000 } },
        {
            evaluate: `(async () => {
  const limit = Math.max(1, Number(\${{ args.limit }}) || 20);
  const cursor = \${{ args.cursor | json }};
  const apiPath = '${ITEM_LIST_API_PATH}';
  const apiUrl = apiPath + '?aid=1988';
  const pageSize = Math.min(Math.max(limit, 1), 50);
  const maxPages = Math.max(1, Math.ceil(limit / pageSize));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function formatDate(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    return new Date(seconds * 1000).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
    });
  }

  function extractUsername(item) {
    const blobs = [
      ...(Array.isArray(item.play_addr) ? item.play_addr : []),
      ...(item.download_info && Array.isArray(item.download_info.download_urls) ? item.download_info.download_urls : []),
    ];
    for (const raw of blobs) {
      try {
        const match = String(raw).match(/[?&]user_text=([^&]+)/);
        if (match) return decodeURIComponent(match[1]);
      } catch (_) {}
    }
    return '';
  }

  function videoUrl(item) {
    const id = item.item_id || item.id || '';
    if (!id) return '';
    const anchor = document.querySelector('a[href*="/video/' + CSS.escape(String(id)) + '"]');
    if (anchor) return new URL(anchor.getAttribute('href'), location.origin).href;
    const username = extractUsername(item);
    return username ? 'https://www.tiktok.com/@' + encodeURIComponent(username) + '/video/' + encodeURIComponent(id) : '';
  }

  async function fetchPage(nextCursor) {
    const body = {
      cursor: Number(nextCursor) || 0,
      size: pageSize,
      query: {
        conditions: [],
        sort_orders: [{ field_name: 'create_time', order: 2 }],
      },
    };
    const res = await fetch(apiUrl, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('TikTok Studio item_list HTTP ' + res.status);
    const data = await res.json();
    if (data.status_msg) throw new Error('TikTok Studio item_list failed: ' + data.status_msg);
    return data;
  }

  const rows = [];
  let nextCursor = cursor;
  for (let page = 0; page < maxPages && rows.length < limit; page++) {
    const data = await fetchPage(nextCursor);
    const items = Array.isArray(data.item_list) ? data.item_list : [];
    rows.push(...items.map((item) => ({
      title: (item.desc || item.title || '').replace(/\\s+/g, ' ').trim(),
      date: formatDate(item.post_time || item.create_time || item.schedule_time),
      views: toNumber(item.play_count),
      likes: toNumber(item.like_count),
      comments: toNumber(item.comment_count),
      saves: toNumber(item.favorite_count),
      shares: toNumber(item.share_count),
      url: videoUrl(item),
    })));
    if (!data.has_more || !items.length) break;
    nextCursor = data.cursor;
    await wait(250);
  }

  if (!rows.length) throw new Error('No TikTok Studio creator videos found; check login/session and Studio content page.');
  return rows.slice(0, limit);
})()
` },
    ],
});