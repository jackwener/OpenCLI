import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'v2ex',
    name: 'member',
    description: 'V2EX 用户资料',
    domain: 'www.v2ex.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'username', required: true, positional: true, help: 'Username' },
    ],
    columns: ['username', 'tagline', 'website', 'github', 'twitter', 'location'],
    presentation: 'detail',
    pipeline: [
        { fetch: {
                url: 'https://www.v2ex.com/api/members/show.json',
                params: { username: '${{ args.username }}' },
            } },
        { map: {
                username: '${{ item.username }}',
                tagline: '${{ item.tagline }}',
                website: '${{ item.website }}',
                github: '${{ item.github }}',
                twitter: '${{ item.twitter }}',
                location: '${{ item.location }}',
            } },
    ],
});
