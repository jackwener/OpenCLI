import { cli } from '@jackwener/opencli/registry';

cli({
    site: 'nowcoder',
    name: 'referral',
    description: 'Internal referral posts',
    domain: 'www.nowcoder.com',
    args: [
        { name: 'page', type: 'int', default: 1, help: 'Page number' },
        { name: 'limit', type: 'int', default: 15, help: 'Number of items' },
    ],
    columns: ['rank', 'title', 'author', 'school', 'likes', 'comments', 'views', 'id'],
    pipeline: [
        { navigate: 'https://www.nowcoder.com' },
        { evaluate: `(async () => {
  const page = \${{ args.page }};
  const limit = \${{ args.limit }};
  const r = await fetch('https://gw-c.nowcoder.com/api/sparta/home/tab/content?tabId=861&categoryType=1&pageNo=' + page + '&pageSize=' + limit, {credentials: 'include'});
  const d = await r.json();
  if (!d.success) throw new Error(d.msg || 'API failed');
  return (d.data?.records || []).map((item, i) => {
    const content = item.contentData || item.momentData || {};
    return {
      rank: i + 1,
      title: content.title || '',
      author: item.userBrief?.nickname || '',
      school: item.userBrief?.educationInfo || '',
      likes: item.frequencyData?.likeCnt || 0,
      comments: item.frequencyData?.commentCnt || 0,
      views: item.frequencyData?.viewCnt || 0,
      id: item.momentData?.uuid || item.contentData?.uuid || item.contentId || '',
    };
  });
})()
` },
        { filter: 'item.title' },
        { limit: '${{ args.limit }}' },
    ],
});
