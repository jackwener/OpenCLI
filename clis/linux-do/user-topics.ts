import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'linux-do',
  name: 'user-topics',
  description: 'linux.do 用户创建的话题',
  domain: 'linux.do',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'username', required: true, positional: true, help: 'Username' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of topics' },
  ],
  columns: ['rank', 'title', 'replies', 'created_at', 'likes', 'views', 'url'],
  pipeline: [
    { navigate: 'https://linux.do' },
    { evaluate: `(async () => {
  const username = \${{ args.username | json }};
  const toLocalTime = (utcStr) => {
    if (!utcStr) return '';
    const date = new Date(utcStr);
    return Number.isNaN(date.getTime()) ? utcStr : date.toLocaleString();
  };
  const res = await fetch('/topics/created-by/' + encodeURIComponent(username) + '.json', { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' - 请先登录 linux.do');
  let data;
  try { data = await res.json(); } catch { throw new Error('响应不是有效 JSON - 请先登录 linux.do'); }
  const topics = data?.topic_list?.topics || [];
  return topics.slice(0, \${{ args.limit }}).map(t => ({
    title: t.fancy_title || t.title || '',
    replies: t.posts_count || 0,
    created_at: toLocalTime(t.created_at),
    likes: t.like_count || 0,
    views: t.views || 0,
    url: 'https://linux.do/t/topic/' + t.id,
  }));
})()
` },
    { map: {
        rank: '${{ index + 1 }}',
        title: '${{ item.title }}',
        replies: '${{ item.replies }}',
        created_at: '${{ item.created_at }}',
        likes: '${{ item.likes }}',
        views: '${{ item.views }}',
        url: '${{ item.url }}',
      } },
  ],
});
