import { cli } from '@jackwener/opencli/registry';

cli({
    site: 'nowcoder',
    name: 'search',
    description: 'Full-text search',
    domain: 'www.nowcoder.com',
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword' },
        { name: 'type', type: 'str', default: 'all', help: 'Search type (all/post/question/user/job)' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results' },
    ],
    columns: ['rank', 'title', 'author', 'school', 'content', 'id'],
    pipeline: [
        { navigate: 'https://www.nowcoder.com' },
        { evaluate: `(async () => {
  const query = \${{ args.query | json }};
  const type = \${{ args.type | json }};
  const limit = \${{ args.limit }};
  const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
  const r = await fetch('https://gw-c.nowcoder.com/api/sparta/pc/search', {
    method: 'POST',
    credentials: 'include',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({query, type, page: 1, pageSize: limit})
  });
  const d = await r.json();
  if (!d.success) throw new Error(d.msg || 'search failed');
  return (d.data?.records || []).map((item, i) => {
    const data = item.data || {};
    const moment = data.momentData || {};
    const contentData = data.contentData || {};
    const user = data.userBrief || {};
    const uuid = moment.uuid || contentData.uuid || '';
    const id = data.contentId || '';
    return {
      rank: i + 1,
      title: moment.title || contentData.title || user.nickname || '',
      author: user.nickname || '',
      school: user.educationInfo || '',
      content: strip(moment.content || contentData.content || ''),
      id: uuid || id,
    };
  }).filter(r => r.title);
})()
` },
        { limit: '${{ args.limit }}' },
    ],
});
