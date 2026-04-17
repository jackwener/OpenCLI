import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'reddit',
    name: 'user',
    description: 'View a Reddit user profile',
    domain: 'reddit.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'username', type: 'string', required: true, positional: true },
    ],
    columns: ['field', 'value'],
    pipeline: [
        { navigate: 'https://www.reddit.com' },
        { evaluate: `(async () => {
  const username = \${{ args.username | json }};
  const name = username.startsWith('u/') ? username.slice(2) : username;
  const res = await fetch('/user/' + name + '/about.json?raw_json=1', {
    credentials: 'include'
  });
  const d = await res.json();
  const u = d?.data || d || {};
  const created = u.created_utc ? new Date(u.created_utc * 1000).toISOString().split('T')[0] : '-';
  return [
    { field: 'Username', value: 'u/' + (u.name || name) },
    { field: 'Post Karma', value: String(u.link_karma || 0) },
    { field: 'Comment Karma', value: String(u.comment_karma || 0) },
    { field: 'Total Karma', value: String(u.total_karma || (u.link_karma||0) + (u.comment_karma||0)) },
    { field: 'Account Created', value: created },
    { field: 'Gold', value: u.is_gold ? '⭐ Yes' : 'No' },
    { field: 'Verified', value: u.verified ? '✅ Yes' : 'No' },
  ];
})()
` },
        { map: { field: '${{ item.field }}', value: '${{ item.value }}' } },
    ],
});
