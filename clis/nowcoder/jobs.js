import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
    site: 'nowcoder',
    name: 'jobs',
    access: 'read',
    description: 'Career category listing',
    domain: 'www.nowcoder.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [],
    columns: ['id', 'career', 'learners'],
    pipeline: [
        { fetch: { url: 'https://gw-c.nowcoder.com/api/sparta/company-question/careerJobLevel1List' } },
        { select: 'data.careerJobSelectors' },
        { map: {
                id: '${{ item.id }}',
                career: '${{ item.name }}',
                learners: `\${{ item.practiceCount || '' }}`,
            } },
    ],
});
