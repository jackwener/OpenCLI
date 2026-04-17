import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
    site: 'nowcoder',
    name: 'creators',
    description: 'Top content creators leaderboard',
    domain: 'www.nowcoder.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 10, help: 'Number of items' },
    ],
    columns: ['rank', 'nickname', 'school', 'level', 'heat', 'tag'],
    pipeline: [
        { fetch: { url: 'https://gw-c.nowcoder.com/api/sparta/content/creator/top-list' } },
        { select: 'data.result' },
        { map: {
                rank: '${{ index + 1 }}',
                nickname: `\${{ item.userBrief?.nickname || '' }}`,
                school: `\${{ item.userBrief?.educationInfo || '' }}`,
                level: `\${{ item.userBrief?.honorLevelName || '' }}`,
                heat: '${{ item.hotValue }}',
                tag: `\${{ item.tag || '' }}`,
            } },
        { limit: '${{ args.limit }}' },
    ],
});
