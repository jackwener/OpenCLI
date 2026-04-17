import { cli } from '@jackwener/opencli/registry';

cli({
    site: 'nowcoder',
    name: 'papers',
    description: 'Interview question bank by company and job',
    domain: 'www.nowcoder.com',
    args: [
        { name: 'job', type: 'str', default: '11002', help: 'Job ID (11002=Java, 11003=C++, 11200=Backend, 11203=QA, 11201=Frontend)' },
        { name: 'company', type: 'str', default: '', help: 'Company ID (e.g. 139=Baidu, 138=Tencent, 239=Huawei)' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of items' },
    ],
    columns: ['rank', 'title', 'company', 'practitioners'],
    pipeline: [
        { navigate: 'https://www.nowcoder.com' },
        { evaluate: `(async () => {
  const jobId = parseInt(\${{ args.job | json }});
  const companyId = \${{ args.company | json }};
  const limit = \${{ args.limit }};
  const body = {jobId, page: 1, pageSize: limit};
  if (companyId) body.companyId = parseInt(companyId);
  const r = await fetch('https://gw-c.nowcoder.com/api/sparta/company-question/get-paper-list', {
    method: 'POST',
    credentials: 'include',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
  const d = await r.json();
  if (!d.success) throw new Error(d.msg || 'API failed');
  return (d.data?.records || []).map((p, i) => ({
    rank: i + 1,
    title: p.paperName || '',
    company: p.companyTag?.name || '',
    practitioners: p.practiceCnt || 0,
  }));
})()
` },
        { limit: '${{ args.limit }}' },
    ],
});
