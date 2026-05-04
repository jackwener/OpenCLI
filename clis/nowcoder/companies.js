import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
    site: 'nowcoder',
    name: 'companies',
    access: 'read',
    description: 'Hot companies for interview prep',
    domain: 'www.nowcoder.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'job', type: 'str', default: '11002', help: 'Job ID (11002=Java, 11003=C++, 11200=Backend, 11203=QA, 11201=Frontend)' },
    ],
    columns: ['rank', 'company', 'companyId'],
    pipeline: [
        { fetch: { url: 'https://gw-c.nowcoder.com/api/sparta/company-question/hot-company-list?jobId=${{ args.job }}' } },
        { select: 'data.result' },
        { map: {
                rank: '${{ index + 1 }}',
                company: '${{ item.companyName }}',
                companyId: '${{ item.companyId }}',
            } },
    ],
});
