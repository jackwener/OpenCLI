import { cli } from '@jackwener/opencli/registry';
import { parseNowcoderPostTarget, projectNowcoderDetail } from './output.js';

cli({
    site: 'nowcoder',
    name: 'detail',
    access: 'read',
    description: 'Content or moment detail (use the ID, UUID, or URL returned by list commands)',
    domain: 'www.nowcoder.com',
    args: [
        { name: 'id', positional: true, required: true, help: 'Post ID, UUID, or URL' },
    ],
    columns: ['post_type', 'id', 'uuid', 'entity_id', 'url', 'title', 'author', 'author_id', 'author_url', 'school', 'content', 'likes', 'comments', 'views', 'time', 'location'],
    pipeline: [
        { navigate: 'https://www.nowcoder.com' },
        { evaluate: `(async () => {
  const raw = \${{ args.id | json }};
  const base = 'https://gw-c.nowcoder.com';
  const parseTarget = ${parseNowcoderPostTarget.toString()};
  const projectDetail = ${projectNowcoderDetail.toString()};
  const target = parseTarget(raw);
  const endpoint = target.post_type === 'moment' ? 'moment-data' : 'content-data';
  const r = await fetch(base + '/api/sparta/detail/' + endpoint + '/detail/' + encodeURIComponent(target.value), {credentials: 'include'});
  const d = await r.json();
  if (!d.success || !d.data) throw new Error((d.msg || 'Post not found') + ': ' + target.value);
  return [projectDetail(d.data, target.post_type)];
})()
` },
    ],
});
