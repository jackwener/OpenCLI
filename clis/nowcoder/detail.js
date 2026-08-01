import { cli } from '@jackwener/opencli/registry';
import { projectNowcoderMetrics } from './metrics.js';

cli({
    site: 'nowcoder',
    name: 'detail',
    access: 'read',
    description: 'Post detail view (supports ID / UUID / URL)',
    domain: 'www.nowcoder.com',
    args: [
        { name: 'id', positional: true, required: true, help: 'Post ID, UUID, or URL' },
    ],
    columns: [
        'title', 'author', 'school', 'content',
        'likes', 'likes_status',
        'collects', 'collects_status',
        'comments', 'comments_status',
        'shares', 'shares_status',
        'views', 'views_status',
        'time', 'location',
    ],
    pipeline: [
        { navigate: 'https://www.nowcoder.com' },
        { evaluate: `(async () => {
  const raw = \${{ args.id | json }};
  const base = 'https://gw-c.nowcoder.com';
  const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
  const projectMetrics = ${projectNowcoderMetrics.toString()};

  let id = raw;
  const urlMatch = raw.match(/discuss\\/(\\d+)/);
  if (urlMatch) id = urlMatch[1];

  let data = null;

  if (/[a-f]/.test(id) && id.length > 20) {
    const r = await fetch(base + '/api/sparta/detail/moment-data/detail/' + id, {credentials: 'include'});
    const d = await r.json();
    if (d.success && d.data) data = d.data;
  }

  if (!data && /^\\d+$/.test(id)) {
    const r = await fetch(base + '/api/sparta/detail/content-data/detail/' + id, {credentials: 'include'});
    const d = await r.json();
    if (d.success && d.data) data = d.data;
  }

  if (!data && /^\\d+$/.test(id)) {
    const r = await fetch(base + '/api/sparta/detail/moment-data/detail/' + id, {credentials: 'include'});
    const d = await r.json();
    if (d.success && d.data) data = d.data;
  }

  if (!data) throw new Error('Post not found: ' + id);

  const user = data.userBrief || {};
  const metrics = projectMetrics(data.frequencyData);
  return [{
    title: data.title || '(untitled)',
    author: user.nickname || '',
    school: user.educationInfo || '',
    content: strip(data.content || '').substring(0, 500),
    ...metrics,
    time: data.createdAt ? new Date(data.createdAt).toISOString().slice(0, 19) : '',
    location: data.ip4Location || '',
  }];
})()
` },
    ],
});
