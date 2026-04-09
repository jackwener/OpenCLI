import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'linux-do',
  name: 'search',
  description: '搜索 linux.do',
  domain: 'linux.do',
  browser: true,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
  ],
  columns: ['rank', 'title', 'views', 'likes', 'replies', 'url'],
  pipeline: [
    { navigate: 'https://linux.do' },
    { evaluate: `(async () => {
  const keyword = \${{ args.query | json }};
  const res = await fetch('/search.json?q=' + encodeURIComponent(keyword), { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' - 请先登录 linux.do');
  let data;
  try { data = await res.json(); } catch { throw new Error('响应不是有效 JSON - 请先登录 linux.do'); }
  const topics = data?.topics || [];
  return topics.slice(0, \${{ args.limit }}).map(t => ({
    title: t.title,
    views: t.views,
    likes: t.like_count,
    replies: (t.posts_count || 1) - 1,
    url: 'https://linux.do/t/topic/' + t.id,
  }));
})()
` },
    { map: {
        rank: '${{ index + 1 }}',
        title: '${{ item.title }}',
        views: '${{ item.views }}',
        likes: '${{ item.likes }}',
        replies: '${{ item.replies }}',
        url: '${{ item.url }}',
      } },
    { limit: '${{ args.limit }}' },
  ],
});
