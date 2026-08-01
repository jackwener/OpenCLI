import { cli } from '@jackwener/opencli/registry';
import { projectNowcoderDetail } from './output.js';

cli({
    site: 'nowcoder',
    name: 'detail',
    access: 'read',
    description: 'Post detail view (supports ID / UUID / URL)',
    domain: 'www.nowcoder.com',
    args: [
        { name: 'id', positional: true, required: true, help: 'Post ID, UUID, or URL' },
    ],
    columns: ['id', 'url', 'title', 'author', 'author_id', 'author_url', 'school', 'content', 'likes', 'comments', 'views', 'time', 'location'],
    pipeline: [
        { navigate: 'https://www.nowcoder.com' },
        { evaluate: `(async () => {
  const raw = String(\${{ args.id | json }});
  const base = 'https://gw-c.nowcoder.com';
  const projectDetail = ${projectNowcoderDetail.toString()};

  let id = raw;
  const urlMatch = raw.match(/discuss\\/([^/?#]+)/);
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

  return [projectDetail(data, id)];
})()
` },
    ],
});
