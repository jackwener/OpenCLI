import { cli } from '@jackwener/opencli/registry';

cli({
    site: 'nowcoder',
    name: 'suggest',
    access: 'read',
    description: 'Search suggestions',
    domain: 'www.nowcoder.com',
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword' },
    ],
    columns: ['rank', 'suggestion', 'type'],
    pipeline: [
        { navigate: 'https://www.nowcoder.com' },
        { evaluate: `(async () => {
  const query = \${{ args.query | json }};
  const r = await fetch('https://gw-c.nowcoder.com/api/sparta/search/suggest', {
    method: 'POST',
    credentials: 'include',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({query})
  });
  const d = await r.json();
  if (!d.success) throw new Error(d.msg || 'suggest failed');
  return (d.data?.records || []).map((item, i) => ({
    rank: i + 1,
    suggestion: item.name || '',
    type: item.typeName || 'general',
  }));
})()
` },
        { limit: '10' },
    ],
});
