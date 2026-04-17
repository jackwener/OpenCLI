import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'instagram',
    name: 'followers',
    description: 'List followers of an Instagram user',
    domain: 'www.instagram.com',
    args: [
        { name: 'username', required: true, positional: true, help: 'Instagram username' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of followers' },
    ],
    columns: ['rank', 'username', 'name', 'verified', 'private'],
    pipeline: [
        { navigate: 'https://www.instagram.com' },
        { evaluate: `(async () => {
  const username = \${{ args.username | json }};
  const limit = \${{ args.limit }};
  const headers = { 'X-IG-App-ID': '936619743392459' };
  const opts = { credentials: 'include', headers };

  const r1 = await fetch(
    'https://www.instagram.com/api/v1/users/web_profile_info/?username=' + encodeURIComponent(username),
    opts
  );
  if (!r1.ok) throw new Error('HTTP ' + r1.status + ' - make sure you are logged in to Instagram');
  const d1 = await r1.json();
  const userId = d1?.data?.user?.id;
  if (!userId) throw new Error('User not found: ' + username);

  const r2 = await fetch(
    'https://www.instagram.com/api/v1/friendships/' + userId + '/followers/?count=' + limit,
    opts
  );
  if (!r2.ok) throw new Error('Failed to fetch followers: HTTP ' + r2.status);
  const d2 = await r2.json();
  return (d2?.users || []).slice(0, limit).map((u, i) => ({
    rank: i + 1,
    username: u.username || '',
    name: u.full_name || '',
    verified: u.is_verified ? 'Yes' : 'No',
    private: u.is_private ? 'Yes' : 'No',
  }));
})()
` },
    ],
});
