import { cli } from '@jackwener/opencli/registry';
import { projectNowcoderFeedItem } from './output.js';

cli({
    site: 'nowcoder',
    name: 'experience',
    access: 'read',
    description: 'Interview experience posts',
    domain: 'www.nowcoder.com',
    args: [
        { name: 'page', type: 'int', default: 1, help: 'Page number' },
        { name: 'limit', type: 'int', default: 15, help: 'Number of items' },
    ],
    columns: ['rank', 'post_type', 'id', 'uuid', 'entity_id', 'url', 'title', 'author', 'author_id', 'author_url', 'school', 'likes', 'comments', 'views'],
    pipeline: [
        { navigate: 'https://www.nowcoder.com' },
        { evaluate: `(async () => {
  const page = \${{ args.page }};
  const limit = \${{ args.limit }};
  const projectItem = ${projectNowcoderFeedItem.toString()};
  const r = await fetch('https://gw-c.nowcoder.com/api/sparta/home/tab/content?tabId=818&categoryType=1&pageNo=' + page + '&pageSize=' + limit, {credentials: 'include'});
  const d = await r.json();
  if (!d.success) throw new Error(d.msg || 'API failed');
  return (d.data?.records || []).map(projectItem);
})()
` },
        { filter: 'item.title' },
        { limit: '${{ args.limit }}' },
    ],
});
