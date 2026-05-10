import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'zhihu',
    name: 'search',
    access: 'read',
    description: '知乎搜索',
    domain: 'www.zhihu.com',
    args: [
        { name: 'query', required: true, positional: true, help: 'Search query' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results' },
    ],
    columns: ['rank', 'title', 'type', 'author', 'votes', 'url'],
    pipeline: [
        { navigate: 'https://www.zhihu.com' },
        { evaluate: `(async () => {
  const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/<em>/g, '').replace(/<\\/em>/g, '').trim();
  const keyword = \${{ args.query | json }};
  const limit = \${{ args.limit }};
  var fetchLimit = Math.max(limit * 3, 30);
  const res = await fetch('https://www.zhihu.com/api/v4/search_v3?q=' + encodeURIComponent(keyword) + '&t=general&offset=0&limit=' + fetchLimit, {
    credentials: 'include'
  });
  const d = await res.json();
  return (d?.data || [])
    .filter(item => item.object && (item.object.type === 'answer' || item.object.type === 'article' || item.object.type === 'question'))
    .map(item => {
      const obj = item.object || {};
      const q = obj.question || {};
      return {
        type: obj.type,
        title: strip(obj.title || q.name || ''),
        excerpt: strip(obj.excerpt || '').substring(0, 100),
        author: obj.author?.name || '',
        votes: obj.voteup_count || 0,
        url: obj.type === 'answer'
          ? 'https://www.zhihu.com/question/' + q.id + '/answer/' + obj.id
          : obj.type === 'article'
          ? 'https://zhuanlan.zhihu.com/p/' + obj.id
          : 'https://www.zhihu.com/question/' + obj.id,
      };
    });
})()
` },
        { map: {
                rank: '${{ index + 1 }}',
                title: '${{ item.title }}',
                type: '${{ item.type }}',
                author: '${{ item.author }}',
                votes: '${{ item.votes }}',
                url: '${{ item.url }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
