import { cli } from '@jackwener/opencli/registry';

cli({
    site: 'nowcoder',
    name: 'practice',
    access: 'read',
    description: 'Categorized practice questions with progress',
    domain: 'www.nowcoder.com',
    args: [
        { name: 'job', type: 'str', default: '11226', help: 'Career ID (11226=Software, 11227=Hardware, 11229=Product, 11230=Finance)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of items' },
    ],
    columns: ['category', 'subject', 'total', 'done', 'remaining'],
    pipeline: [
        { navigate: 'https://www.nowcoder.com' },
        { evaluate: `(async () => {
  const jobId = \${{ args.job | json }};
  const limit = \${{ args.limit }};
  const r = await fetch('https://gw-c.nowcoder.com/api/sparta/intelligent/getPCIntelligentList?jobId=' + jobId, {credentials: 'include'});
  const d = await r.json();
  if (!d.success) throw new Error(d.msg || 'API failed');
  const all = [];
  for (const tag of (d.data?.tags || [])) {
    for (const item of (tag.items || [])) {
      all.push({
        category: tag.title || 'recommended',
        subject: item.title,
        total: item.tcount,
        done: item.rcount,
        remaining: item.leftCount,
      });
    }
  }
  return all.slice(0, limit);
})()
` },
    ],
});
