import { cli } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';

function positiveInteger(value, name) {
    const text = String(value ?? '').trim();
    if (!/^[1-9]\d*$/.test(text)) {
        throw new ArgumentError(`nowcoder papers --${name} must be a positive integer`);
    }
    const number = Number(text);
    if (!Number.isSafeInteger(number)) {
        throw new ArgumentError(`nowcoder papers --${name} is too large`);
    }
    return number;
}

function validateArgs(args) {
    positiveInteger(args.job ?? '11002', 'job');
    positiveInteger(args.limit ?? 10, 'limit');
    if (args.company !== '' && args.company != null) positiveInteger(args.company, 'company');
}

cli({
    site: 'nowcoder',
    name: 'papers',
    access: 'read',
    description: 'Interview question bank by company and job',
    domain: 'www.nowcoder.com',
    args: [
        { name: 'job', type: 'str', default: '11002', help: 'Job ID (11002=Java, 11003=C++, 11200=Backend, 11203=QA, 11201=Frontend)' },
        { name: 'company', type: 'str', default: '', help: 'Company ID (e.g. 139=Baidu, 138=Tencent, 239=Huawei)' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of items' },
    ],
    columns: ['rank', 'id', 'title', 'company', 'practitioners'],
    validateArgs,
    pipeline: [
        { navigate: 'https://www.nowcoder.com' },
        { evaluate: `(async () => {
  const jobId = Number(\${{ args.job | json }});
  const companyId = Number(\${{ args.company | json }} || 0);
  const limit = \${{ args.limit }};
  const body = {
    order: 0,
    page: 1,
    pageSize: limit,
    careerJob: 11226,
    jobIds: [jobId],
    companyIds: companyId ? [companyId] : [],
    query: '',
  };
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
    id: String(p.paperId ?? ''),
    title: p.paperName || '',
    company: p.companyTag?.name || '',
    practitioners: p.practiceCnt || 0,
  }));
})()
` },
        { limit: '${{ args.limit }}' },
    ],
});
