import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { DOMAIN, SITE, gqlEscape, gqlRequest, stripHtml } from './_helpers.js';
cli({
    site: SITE,
    name: 'user',
    description: 'User profile',
    domain: DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'username',
            type: 'string',
            required: true,
            positional: true,
            help: 'LessWrong username or slug',
        },
    ],
    columns: ['field', 'value'],
    func: async (_page, kwargs) => {
        const slug = gqlEscape(String(kwargs.username).toLowerCase());
        const query = `query UserProfile {
      user(input: {selector: {slug: "${slug}"}}) {
        result { _id displayName slug bio karma postCount commentCount createdAt }
      }
    }`;
        const data = await gqlRequest(query);
        const user = data?.user?.result;
        if (!user?._id) {
            throw new EmptyResultError(`lesswrong user ${String(kwargs.username)}`, 'Check the username — LessWrong slugs are lowercase (e.g. "zvi", "eliezer-yudkowsky")');
        }
        return [
            { field: 'Name', value: user.displayName ?? '' },
            { field: 'Username', value: user.slug ?? '' },
            { field: 'Karma', value: user.karma ?? 0 },
            { field: 'Posts', value: user.postCount ?? 0 },
            { field: 'Comments', value: user.commentCount ?? 0 },
            { field: 'Joined', value: user.createdAt ?? '' },
            { field: 'Bio', value: stripHtml(user.bio ?? '') },
            { field: 'URL', value: `https://${DOMAIN}/users/${user.slug}` },
        ];
    },
});
