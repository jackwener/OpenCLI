import { cli } from '@jackwener/opencli/registry';
import { projectNowcoderSearchItem } from './output.js';

cli({
    site: 'nowcoder',
    name: 'search',
    access: 'read',
    description: 'Full-text search',
    domain: 'www.nowcoder.com',
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword' },
        { name: 'type', type: 'str', default: 'all', help: 'Search type (all/post/question/user/job)' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results' },
    ],
    columns: ['rank', 'title', 'author', 'author_id', 'author_url', 'school', 'content', 'id', 'url'],
    pipeline: [
        { navigate: 'https://www.nowcoder.com' },
        { evaluate: `(async () => {
  const query = \${{ args.query | json }};
  const type = \${{ args.type | json }};
  const limit = \${{ args.limit }};
  const projectItem = ${projectNowcoderSearchItem.toString()};
  const r = await fetch('https://gw-c.nowcoder.com/api/sparta/pc/search', {
    method: 'POST',
    credentials: 'include',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({query, type, page: 1, pageSize: limit})
  });
  const d = await r.json();
  if (!d.success) throw new Error(d.msg || 'search failed');
  return (d.data?.records || []).map(projectItem).filter(r => r.title);
})()
` },
        { limit: '${{ args.limit }}' },
    ],
});
